const gulp = require('gulp');
const pkg = require('./package.json');
const merge = require('event-stream').merge;
const gutil = require('gulp-util');
const runSequence = require('run-sequence');
const browserSync = require('browser-sync').create();
const $ = require('gulp-load-plugins')();
const eco = require('eco');
const fs = require('fs');
const ancss = require('ancss');
const autoprefixer = require('autoprefixer');
const cssnext = require('postcss-cssnext');
const reporter = require('postcss-reporter');
const historyApiFallback = require('connect-history-api-fallback');
const file = require('gulp-file');
const {rollup} = require('rollup');
const babel = require('rollup-plugin-babel');
const commonjs = require('rollup-plugin-commonjs');
const glob = require('glob');
const rimraf = require('rimraf');
const path = require('path');
const yaml = require('js-yaml');

const prefix = __dirname + '/../build/css/';

////////////////////////////////////////
// build
////////////////////////////////////////
gulp.task('build', (done) => {
  runSequence('build-css', 'generate-preview', done);
});

////////////////////////////////////////
// build-css
////////////////////////////////////////
gulp.task('build-css', ['css-clean', 'cssnext', 'cssmin']);

////////////////////////////////////////
// stylelint
////////////////////////////////////////
gulp.task('stylelint', () => {
  return gulp.src([
      './src/**/*.css',
      '!./src/components/combination.css', // not following BEM
      '!./src/iphonex-support/**/*.css' // not following BEM
    ])
    .pipe($.stylelint({
      failAfterError: false,
      reporters: [{formatter: 'string', console: true}]
    }));
});

////////////////////////////////////////
// cssmin
////////////////////////////////////////
gulp.task('cssmin', ['cssnext'], () => {
  return gulp.src(prefix + '{*-,}onsen-css-components.css')
    .pipe($.cssmin())
    .pipe($.rename({suffix: '.min'}))
    .pipe(gulp.dest('./build/'))
    .pipe(gulp.dest(prefix));
});

////////////////////////////////////////
// cssnext
////////////////////////////////////////
gulp.task('cssnext', ['stylelint'], () => {
  const plugins = [
    require('postcss-import'),
    require('postcss-base64')({
      extensions: ['.svg'],
      root: __dirname + '/src/components/'
    }),
    cssnext({
      browsers: [ // enable CSS properties which require prefixes
        '> 1%', 'Firefox ESR', 'Opera 12.1',
        'Android >= 4.4',
        'iOS >= 8.0',
        'Chrome >= 30', // equivalent to Android 4.4 WebView
        'Safari >= 9',
      ],
    }),
    reporter({
      clearAllMessages: true,
      clearReportedMessages: true,
      throwError: false
    })
  ];

  return gulp.src('src/{*-,}onsen-css-components.css')
    .pipe($.plumber())
    .pipe($.postcss(plugins))
    .pipe(gulp.dest('./build/'))
    .pipe(gulp.dest(prefix))
    .pipe(browserSync.stream());
});

gulp.task('css-clean', () => {
  rimraf.sync(__dirname + '/build/{*-,}onsen-css-components.css');
  rimraf.sync(__dirname + '/build/{*-,}onsen-css-components.min.css');
  rimraf.sync(prefix + '/{*-,}onsen-css-components.css');
  rimraf.sync(prefix + '/{*-,}onsen-css-components.min.css');
});

////////////////////////////////////////
// generate-preview
////////////////////////////////////////
let lastMarkupToken = '';
gulp.task('generate-preview', (done) => {
  const components = parseComponents();
  const markupToken = identifyComponentsMarkup(components);

  if (markupToken !== lastMarkupToken) {
    runSequence('preview-assets', 'preview-js', () => {
      generate(components);
      browserSync.reload();

      lastMarkupToken = markupToken;
      done();
    });
  } else {
    lastMarkupToken = markupToken;
    done();
  }
});

gulp.task('generate-preview-force', ['preview-assets', 'preview-js'], () => {
  generate(parseComponents());
  browserSync.reload();
});

function generate(components) {
  const template = fs.readFileSync(__dirname + '/previewer-src/index.html.eco', 'utf-8');
  const patterns = yaml.safeLoadAll(fs.readFileSync(__dirname + '/patterns.yaml', 'utf-8'));
  const themes = glob.sync(__dirname + '/build/{*-,}onsen-css-components.css').map(filePath => path.basename(filePath, '.css'));
  const toJSON = JSON.stringify.bind(JSON);

  fs.writeFileSync(__dirname + '/build/index.html', eco.render(template, {toJSON, components, themes, patterns}), 'utf-8');
}

function identifyComponentsMarkup(componentsJSON) {
  const token = componentsJSON.map(component => {
    return component.annotation.markup;
  }).join('');

  return token;
}

function parseComponents() {
  const css = fs.readFileSync(__dirname + '/build/onsen-css-components.css', 'utf-8');
  const components = ancss.parse(css, {detect: line => line.match(/^~/)});
  return components || [];
}

////////////////////////////////////////
// preview-assets
////////////////////////////////////////
gulp.task('preview-assets', () => {
  return gulp.src('previewer-src/*.{svg,css}')
    .pipe(gulp.dest('./build/'));
});

////////////////////////////////////////
// preview-js
////////////////////////////////////////
gulp.task('preview-js', function() {
  return rollup({
    entry: 'previewer-src/app.js',
    plugins: [
      commonjs,
      babel({
        presets: [
          ['es2015', {'modules': false}]
        ],
        babelrc: false,
        exclude: 'node_modules/**'
      })
    ]
  })
  .then(bundle => {
    return bundle.write({
      dest: 'build/app.gen.js',
      format: 'umd',
      sourceMap: 'inline'
    });
  });
});

////////////////////////////////////////
// serve
////////////////////////////////////////
gulp.task('serve', ['reset-console', 'build'], done => {
  gulp.watch(['src/**/*.css'], () => {
    reset();
    runSequence('build-css', 'generate-preview', outputDevServerInfo);
  });

  gulp.watch(['previewer-src/**', 'patterns.yaml'], () => {
    reset();
    runSequence('generate-preview-force', outputDevServerInfo)
  });

  browserSync.emitter.on('init', outputDevServerInfo);

  browserSync.init({
    logLevel: 'silent',
    ui: false,
    port: 4321,
    notify: false,
    server: {
      baseDir: __dirname + '/build',
      middleware: [historyApiFallback()],
    },
    startPath: '/',
    open: false
  });
});

////////////////////////////////////////
// reset-console
////////////////////////////////////////
gulp.task('reset-console', reset);

function reset() {
  process.stdout.write('\033c');
}

const outputDevServerInfo = (() => {
  let defer = true;

  return function () {
    if (defer) {
      setTimeout(() => {
        output();
        defer = true;
      }, 60);
      defer = false;
    }
  }

  function output() {
    const localUrl = browserSync.getOption('urls').get('local'); 
    const externalUrl = browserSync.getOption('urls').get('external'); 

    console.log('\nAccess URLs:');
    console.log('     Local:', gutil.colors.magenta(localUrl));
    console.log('  External:', gutil.colors.magenta(externalUrl));
    console.log();

    displayBuildCSSInfo();
  }
})();

function displayBuildCSSInfo() {

  console.log('Built CSS Files:')
  getCSSPaths().forEach(cssPath => {
    console.log('  ' + gutil.colors.magenta(cssPath));
  });

  function getCSSPaths() {
    return glob.sync(__dirname + '/build/{*-,}onsen-css-components.css').map(cssPath => {
      return '.' + path.sep + path.relative(__dirname, cssPath);
    });
  }
}

function getCSSPaths() {
  return glob.sync(__dirname + '/build/{*-,}onsen-css-components.css').map(cssPath => {
    return '.' + path.sep + path.relative(__dirname, cssPath);
  });
}
