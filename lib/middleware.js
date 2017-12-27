const _ = require('lodash');
const minimatch = require('minimatch');
const fs = require('fs');
const path = require('path');
const istanbul = require('istanbul');
const scriptHook = require('html-script-hook');

// istanbul
const instrumenter = new istanbul.Instrumenter({
  coverageVariable: "WCT.share.__coverage__"
});

// helpers
var cache = {};

const instrumentHtml = (htmlFilePath) => {
  var asset = htmlFilePath;
  var code;

  if ( !cache[asset] ){
    html = fs.readFileSync(htmlFilePath, 'utf8');

    cache[asset] = scriptHook (html, {scriptCallback: gotScript});
  }

  function gotScript(code, loc) {
    return instrumenter.instrumentSync(code, htmlFilePath);
  }

  return cache[asset];
};

const instrumentAsset = (assetPath) => {
    const asset = assetPath;
    let code;

    if (!fs.existsSync(assetPath)) {
      return;
    }

    if ( !cache[asset] ){
        code = fs.readFileSync(assetPath, 'utf8');

        // NOTE: the instrumenter must get a file system path not a wct-webserver path.
        // If given a webserver path it will still generate coverage, but some reporters
        // will error, siting that files were not found
        // (thedeeno)
        cache[asset] = instrumenter.instrumentSync(code, assetPath);
    }

    return cache[asset];
}


/**
 * Middleware that serves an instrumented asset based on user
 * configuration of coverage
 */
const coverageMiddleware = (root, options, wctOpts, emitter) => {
  const clientRoot = emitter.options.clientOptions.root;
  const pkgName = wctOpts.packageName;

  return (req, res, next) => {
    let relativePath = req.url.replace(clientRoot, '');

    // we parse the files that where in the component path (pkgName)
    if (relativePath.startsWith(pkgName)) {
      relativePath = relativePath.replace(path.join(pkgName, path.sep), '');

      // check asset against rules
      const process = pathMatchesOpt(relativePath, options);

      const absolutePath = path.join(root, relativePath);

      // instrument unfiltered assets
      if ( process ) {
        if (absolutePath.match(/\.htm(l)?$/)) {
          let html = instrumentHtml(absolutePath);
          if (html) {
            emitter.emit('log:debug', 'coverage', 'instrument', absolutePath);
            return res.send(html);
          }
        } else {
          let instrAsset = instrumentAsset(absolutePath);
          if (instrAsset) {
            emitter.emit('log:debug', 'coverage', 'instrument', absolutePath);
            return res.send(instrAsset);
          }
        }
      }
    }
    emitter.emit('log:debug', 'coverage', 'skip      ', relativePath);
    return next();
  };
};

/**
 * Clears the instrumented code cache
 */
const cacheClear = () => {
  cache = {};
};

/**
 * Returns true if the supplied string mini-matches any of the supplied patterns
 */
const match = (str, rules) => {
    return _.some(rules, minimatch.bind(null, str));
};

/**
 * Returns the files in the dir parameter directory recursively.
 * @param {String} dir: Path where it will read the files recursively.
 * @param {List} filelist: It is used in the recursion. First time it can be undefined or empty list.
 * @returns A list with all the files in the dir directory. 
 */
const readFilesRecursiveSync = (dir, filelist) => {
  let files = fs.readdirSync(dir);
  filelist = filelist || [];
  files.forEach(function(file) {
      if (fs.statSync(path.join(dir, file)).isDirectory()) {
          filelist = readFilesRecursiveSync(path.join(dir, file), filelist);
      }
      else {
          filelist.push(path.join(dir, file));
      }
  });
  return filelist;
};

/**
 * Returns the files that have not been processed in the middleware function and that match with the options 
 * include pattern and they don't match with the options exclude pattern.
 * @param {String} dir: Path where we have to search the files with non coverage.
 * @param {Object} options: 
 */
const getFilesNotCoveraged = (dir, options) => {
  const listFiles = readFilesRecursiveSync(dir);
  let cacheKeys = Object.keys(cache);
  let result = [];
  listFiles.forEach(
    file => {
      const absoluteFile = path.resolve(file);
      if (cacheKeys.indexOf(absoluteFile) < 0) {
        const matches = pathMatchesOpt(file.replace(path.join(dir, path.sep), ''), options);
        if (matches) {
          result.push(absoluteFile);
        }
      }
    }
  );

  return result;
};

function pathMatchesOpt (relativePath, options) {
  // always ignore platform files in addition to user's blacklist
  let blacklist = ['web-component-tester/*'].concat(options.exclude);
  let whitelist = options.include;

  // check asset against rules
  return match(relativePath, whitelist) && !match(relativePath, blacklist);
}

module.exports = {
  middleware: coverageMiddleware,
  cacheClear: cacheClear,
  getFilesNotCoveraged: getFilesNotCoveraged
};
