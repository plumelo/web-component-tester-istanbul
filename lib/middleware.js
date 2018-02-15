const _ = require('lodash');
const minimatch = require('minimatch');
const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const dom5 = require('dom5');
const pred = dom5.predicates;
const strip = require('strip-comments');
const istanbul = require('istanbul');

const HREF_SCRIPT_PRED = pred.AND(pred.hasTagName('script'), pred.NOT(pred.hasAttr('src')));

const getScriptHtmlTags = (htmlCode) => {
  const doc = parse5.parse(htmlCode, {locationInfo: true});
  const scriptTags = dom5.queryAll(doc, HREF_SCRIPT_PRED);
  let scriptContent = [];

  scriptTags.forEach(
    scriptTag => {
        const content = strip(dom5.getTextContent(scriptTag)).trim();
        scriptContent.push(content);
    }
  );

  return scriptContent.join(';');
}


// istanbul
const instrumenter = new istanbul.Instrumenter({
  coverageVariable: "WCT.share.__coverage__"
});

// helpers
var cache = {};

const instrumentHtml = (htmlFilePath) => {
  let asset = htmlFilePath;

  if ( !cache[asset] ){
    html = fs.readFileSync(htmlFilePath, 'utf8');

    let code = getScriptHtmlTags(html);
    if (code) {
      cache[asset] = instrumenter.instrumentSync(code, htmlFilePath);
    }
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
 * Returns the instrumented asset depending on if the absolutePath represents an html file or not
 * @param {String} absolutePath 
 */
const instrumentElem = (absolutePath) => {
  if (absolutePath.match(/\.htm(l)?$/)) {
    return instrumentHtml(absolutePath);
  } else {
    return instrumentAsset(absolutePath);
  }
};

/**
 * Middleware that serves an instrumented asset based on user
 * configuration of coverage
 */
const coverageMiddleware = (root, options, wctOpts, emitter) => {
  const clientRoot = path.normalize(emitter.options.clientOptions.root);
  const pkgName = path.normalize(wctOpts.packageName);

  return (req, res, next) => {
    let normalizedReqUrl = path.normalize(req.url)
    let relativePath = normalizedReqUrl.replace(clientRoot, '');

    // we parse the files that where in the component path (pkgName)
    if (relativePath.startsWith(pkgName)) {
      relativePath = relativePath.replace(path.join(pkgName, path.sep), '');

      // check asset against rules
      const process = pathMatchesOpt(relativePath, options);

      const absolutePath = path.join(root, relativePath);

      // instrument unfiltered assets
      if ( process ) {
        let asset = instrumentElem(absolutePath);
        if (asset) {
          emitter.emit('log:debug', 'coverage', 'instrument', absolutePath);
          return res.send(asset);
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
 * Returns the coveraged of files that have not been processed in the middleware function and that match with the options 
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
          let asset = instrumentElem(absoluteFile);
          if (asset) {
            const lastCvg = {[absoluteFile]: instrumenter.lastFileCoverage()};
            result.push(Object.assign({}, lastCvg));
          }
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
