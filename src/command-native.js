var fs            = require('fs'),
    os            = require('os'),
    path          = require('path'),
    child_process = require('child_process'),
    concat_stream = require('concat-stream'),
    reportError   = require('./util').reportError,
    TypeSystem    = require('./typesystem').TypeSystem,
    Parser        = require('./parser'),
    Compiler      = require('./compiler')

// Load source map support and LLVM target
require('source-map-support').install()
var LLVMCompiler = require('./targets/llvm').LLVMCompiler

// Command-line arguments ----------------------------------------------------

var optimist = require('optimist'),
    argv = optimist
    // .usage('Usage: hbn [options] [entry]')
    .boolean('gc').default('gc', true)
    .boolean('dump').default('dump', false)
    .argv

function getArg (name) {
  var value = argv[name]
  if (value === undefined) {
    throw new Error('Failed to find argument: '+name)
  }
  return value
}
function hasArg (name) {
  return (process.argv.indexOf('-'+name) !== -1)
}
var Opts = {
  outFile:     hasArg('o') ? getArg('o') : 'a.out',
  verbose:     hasArg('v'),
  veryVerbose: hasArg('vv'),
  gc:          getArg('gc'),
  dump:        (argv.dump === true ? true : false)
}


// Logging -------------------------------------------------------------------

var logLevel = 'warn'
if (Opts.verbose)     { logLevel = 'info' }
if (Opts.veryVerbose) { logLevel = 'debug' }

var winston = require('winston'),
    logger  = new winston.Logger()
logger.add(winston.transports.Console, {
  colorize: true,
  level:    logLevel
})

function showHelp() {
  // var help = optimist.help().trim()+"\n"
  var help = "Usage: hbn [entry-file] [options]\n\n"
  help += "Options:\n"
  help += "  --no-gc  Don't link the GC\n"
  help += "  -v       Verbose\n"
  help += "  -vv      Extra-verbose (overrides -v)\n"
  help += "  --dump   Dump LLVM module"
  console.error(help)
}
if (argv._.length === 0 || argv._[0] === 'help') {
  showHelp()
  process.exit(0)
}

var entryFile = argv._[0]
// binFile = 'a.out' // entryFile.replace(/\.hb$/i, '')

if (entryFile === '-') {
  var BUFFER_SIZE = 4096,
      buffer      = new Buffer(BUFFER_SIZE),
      bytesRead   = null,
      data        = ''
  while (true) {
    bytesRead = 0
    try {
      bytesRead = fs.readSync(process.stdin.fd, buffer, 0, BUFFER_SIZE)
    } catch (err) {
      if (err.code === 'EOF') { break }
      throw err
    }
    // Break if we didn't read anything
    if (bytesRead === 0) { break } 
    // Add on the bytes we read from the `readBuffer`
    data += buffer.toString(null, 0, bytesRead)
  }
  // Write it to a temporary file
  var tempPath = path.join(os.tmpdir(), 'input.hb')
  fs.writeFileSync(tempPath, data)
  // Then use that as the entry file
  entryFile = tempPath
}

var parser     = new Parser(),
    compiler   = new Compiler()

try {
  var entryDirectory = path.dirname(entryFile)
  compiler.importPath.push(entryDirectory)
  var file = compiler.compile(entryFile, {isEntry: true}),
      tree = file.tree

  // var source = fs.readFileSync(entryFile).toString()
  // var tree = parser.parse(source)
  // typesystem.walk(tree)
} catch (err) {
  reportError(err)
  process.exit(1)
}

var outputs  = [],
    compiler = new LLVMCompiler()
compiler.emitToFile(tree, {logger: logger, outputs: outputs, dump: Opts.dump})

function objectFileForBitcodeFile (path) {
  return path.replace(/\.bc$/, '.o')
}

function execSync (cmd) {
  var execSync = child_process.execSync
  logger.info('exec:', cmd)
  execSync(cmd)
}

var llc = null
var llcsToTry = ['llc', 'llc-3.6'];
for (var i = 0; i < llcsToTry.length; i++) {
  var c = llcsToTry[i],
      s = child_process.spawnSync('which', [c]).status
  // `which` exits with 0 status on success
  if (s === 0) {
    llc = c; break
  }
}
if (llc === null) {
  throw new Error('No `llc` command found')
}

// Compile using the LLVM bitcode-to-assembly/object compiler
outputs.forEach(function (of) {
  execSync(llc+' -filetype=obj '+of)
})
// process.exit(0)

var gc = '-lgc'
if (!Opts.gc) { gc = '' }
// Then compile the object file to a native binary
// execSync('clang -o '+binFile+' '+gc+' -Wl,lib/std.o '+objFile)

var stdFile    = 'lib/std.o',
    linkerObjs = []

outputs.map(objectFileForBitcodeFile).forEach(function (obj) {
  linkerObjs.push(obj)
})
linkerObjs.push(stdFile)

/*
var platformFlags = '',
    crt           = '/usr/lib/crt1.o'

if (process.platform === 'darwin') {
  platformFlags = '-macosx_version_min 10.9'
}
if (process.platform === 'linux') {
  // Set the correct dynamic linker
  linkerObjs.unshift('-dynamic-linker /lib64/ld-linux-x86-64.so.2')
  crt = '/usr/lib/x86_64-linux-gnu/crt1.o'
}
linkerObjs.unshift(crt)
execSync('ld '+linkerObjs.join(' ')+' -lgc -lc '+platformFlags+' -o '+Opts.outFile)
*/
  
execSync('clang '+linkerObjs.join(' ')+' -lgc -o '+Opts.outFile)

