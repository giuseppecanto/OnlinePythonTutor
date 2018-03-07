/*

Online Python Tutor
https://github.com/pgbovine/OnlinePythonTutor/

Copyright (C) Philip J. Guo (philip@pgbovine.net)

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/

// This is a nodejs server based on express that serves the v4-cokapi/ app,
// which implements OPT language backends for languages such as Java,
// Ruby, JavaScript, TypeScript, C, C++, ...

// To test locally, run 'make' and load http://localhost:3000/

// Run with an 'https' command-line flag to use https (must have
// the proper certificate and key files, though)

var assert = require('assert');
var child_process = require('child_process');
var express = require('express');
var util = require('util');


// We use this to execute since it supports utf8 and also an optional
// timeout, but it needs the exact location of binaries because it doesn't
// spawn a shell
// http://nodejs.org/api/child_process.html#child_process_child_process_execfile_file_args_options_callback

var TIMEOUT_SECS = 15;

var MAX_BUFFER_SIZE = 10 * 1024 * 1024;

var MEM_LIMIT = "512M";


// bind() res and useJSONP before using
function postExecHandler(res, useJSONP, err, stdout, stderr) {
  var errTrace;
  if (err) {
    console.log('postExecHandler', util.inspect(err, {depth: null}));
    if (err.killed) {
      // timeout!
      errTrace = {code: '', trace: [{'event': 'uncaught_exception',
                                     'exception_msg': 'Error: Your code ran for more than ' + TIMEOUT_SECS + ' seconds. It may have an INFINITE LOOP.\nOr the server may be OVERLOADED right now.\nPlease try again later, or shorten your code. [#BackendError]'}]};
      if (useJSONP) {
        res.jsonp(errTrace /* return an actual object, not a string */);
      } else {
        res.send(JSON.stringify(errTrace));
      }
    } else {
      if (err.code === 42) {
        // special error code for instruction_limit_reached in jslogger.js
        errTrace = {code: '', trace: [{'event': 'uncaught_exception',
                                       'exception_msg': 'Error: stopped after running 1000 steps and cannot display visualization.\nShorten your code, since Python Tutor is not designed to handle long-running code.'}]};
      } else {
        errTrace = {code: '', trace: [{'event': 'uncaught_exception',
                                       'exception_msg': "Unknown error. The server may be OVERLOADED right now; please try again later.\nYour code may also contain UNSUPPORTED FEATURES that the tool cannot handle.\nReport a bug to philip@pgbovine.net by clicking on the 'Generate shortened link'\nbutton at the bottom and including a URL in your email. [#BackendError]"}]};
                                       // old error message, retired on 2018-03-02
                                       //'exception_msg': "Unknown error. The server may be down or overloaded right now.\nReport a bug to philip@pgbovine.net by clicking on the\n'Generate permanent link' button at the bottom and including a URL in your email."}]};
      }

      if (useJSONP) {
        res.jsonp(errTrace /* return an actual object, not a string */);
      } else {
        res.send(JSON.stringify(errTrace));
      }
    }
  } else {
    if (useJSONP) {
      try {
        // stdout better be real JSON, or we've got a problem!!!
        var stdoutParsed = JSON.parse(stdout);
        res.jsonp(stdoutParsed /* return an actual object, not a string */);
      } catch(e) {
        errTrace = {code: '', trace: [{'event': 'uncaught_exception',
                                       'exception_msg': "Unknown error. The server may be OVERLOADED right now; please try again later.\nYour code may also contain UNSUPPORTED FEATURES that the tool cannot handle.\nReport a bug to philip@pgbovine.net by clicking on the 'Generate shortened link'\nbutton at the bottom and including a URL in your email. [#BackendError]"}]};
                                       // old error message, retired on 2018-03-02
                                       //'exception_msg': "Unknown error. The server may be down or overloaded right now.\nReport a bug to philip@pgbovine.net by clicking on the\n'Generate permanent link' button at the bottom and including a URL in your email."}]};
        res.jsonp(errTrace /* return an actual object, not a string */);
      }
    } else {
      res.send(stdout);
    }
  }
}


var app = express();

// http://ilee.co.uk/jsonp-in-express-nodejs/
app.set("jsonp callback", true);

app.get('/exec_js', exec_js_handler.bind(null, false, false));
app.get('/exec_js_jsonp', exec_js_handler.bind(null, true, false));

app.get('/exec_ts', exec_js_handler.bind(null, false, true));
app.get('/exec_ts_jsonp', exec_js_handler.bind(null, true, true));

function exec_js_handler(useJSONP /* use bind first */, isTypescript /* use bind first */, req, res) {
  var usrCod = req.query.user_script;

  var exeFile;
  var args = [];

  // must match the docker setup in backends/javascript/Dockerfile
  exeFile = '/usr/bin/docker'; // absolute path to docker executable
  args.push('run', '-m', MEM_LIMIT, '--rm', '--user=netuser', '--net=none', '--cap-drop', 'all', 'pgbovine/cokapi-js:v1',
            '/tmp/javascript/node-v6.0.0-linux-x64/bin/node', // custom Node.js version
            '--expose-debug-as=Debug',
            '/tmp/javascript/jslogger.js');

  if (isTypescript) {
    args.push('--typescript=true');
  }
  args.push('--jsondump=true');
  args.push('--code=' + usrCod);

  child_process.execFile(exeFile, args,
                         {timeout: TIMEOUT_SECS * 1000 /* milliseconds */,
                          maxBuffer: MAX_BUFFER_SIZE,
                          // SIGINT isn't as "strong" but docker seems
                          // to clean up containers better with it. the
                          // problem with SIGKILL is that containers
                          // don't seem to be properly cleaned up ...
                          killSignal: 'SIGKILL'},
                         postExecHandler.bind(null, res, useJSONP));
}


app.get('/exec_java', exec_java_handler.bind(null, false));
app.get('/exec_java_jsonp', exec_java_handler.bind(null, true));

// runs David Pritchard's Java backend in backends/java/
function exec_java_handler(useJSONP /* use bind first */, req, res) {
  var usrCod = req.query.user_script;

  var parsedOptions = JSON.parse(req.query.options_json);
  var heapPrimitives = parsedOptions.heap_primitives;

  var exeFile;
  var args = [];

  var inputObj = {};
  inputObj.usercode = usrCod;
  // TODO: add options, arg, and stdin later ...
  inputObj.options = {};
  inputObj.args = [];
  inputObj.stdin = "";

  // VERY unintuitive -- to get strings to display as heap objects and
  // NOT 'primitive' values in the Java backend, set showStringsAsValues
  // to false
  if (heapPrimitives) {
    inputObj.options.showStringsAsValues = false;
  }

  var inputObjJSON = JSON.stringify(inputObj);

  // must match the docker setup in backends/java/Dockerfile
  exeFile = '/usr/bin/docker'; // absolute path to docker executable
  args.push('run', '-m', MEM_LIMIT, '--rm', '--user=netuser', '--net=none', '--cap-drop', 'all', 'pgbovine/cokapi-java:v1',
            '/tmp/run-java-backend.sh',
            inputObjJSON);

  child_process.execFile(exeFile, args,
                         {timeout: TIMEOUT_SECS * 1000 /* milliseconds */,
                          maxBuffer: MAX_BUFFER_SIZE,
                          // SIGINT isn't as "strong" but docker seems
                          // to clean up containers better with it. the
                          // problem with SIGKILL is that containers
                          // don't seem to be properly cleaned up ...
                          killSignal: 'SIGKILL'},
                         postExecHandler.bind(null, res, useJSONP));
}


app.get('/exec_ruby', exec_ruby_handler.bind(null, false));
app.get('/exec_ruby_jsonp', exec_ruby_handler.bind(null, true));

function exec_ruby_handler(useJSONP /* use bind first */, req, res) {
  var usrCod = req.query.user_script;

  var exeFile;
  var args = [];

  // must match the docker setup in backends/ruby/Dockerfile
  exeFile = '/usr/bin/docker'; // absolute path to docker executable
  args.push('run', '-m', MEM_LIMIT, '--rm', '--user=netuser', '--net=none', '--cap-drop', 'all', 'pgbovine/cokapi-ruby:v1',
            '/tmp/ruby/ruby',
            '/tmp/ruby/pg_logger.rb',
            '-c',
            usrCod);

  child_process.execFile(exeFile, args,
                         {timeout: TIMEOUT_SECS * 1000 /* milliseconds */,
                          maxBuffer: MAX_BUFFER_SIZE,
                          // SIGINT isn't as "strong" but docker seems
                          // to clean up containers better with it. the
                          // problem with SIGKILL is that containers
                          // don't seem to be properly cleaned up ...
                          killSignal: 'SIGKILL'},
                         postExecHandler.bind(null, res, useJSONP));
}


app.get('/exec_c', exec_cpp_handler.bind(null, false, false));
app.get('/exec_c_jsonp', exec_cpp_handler.bind(null, false, true));
app.get('/exec_cpp', exec_cpp_handler.bind(null, true, false));
app.get('/exec_cpp_jsonp', exec_cpp_handler.bind(null, true, true));

function exec_cpp_handler(useCPP /* use bind first */, useJSONP /* use bind first */, req, res) {
  var usrCod = req.query.user_script;

  var exeFile;
  var args = [];

  // must match the docker setup in backends/c_cpp/Dockerfile
  exeFile = '/usr/bin/docker'; // absolute path to docker executable
  args.push('run', '-m', MEM_LIMIT, '--rm', '--user=netuser', '--net=none', '--cap-drop', 'all', 'pgbovine/opt-cpp-backend:v1',
            'python',
            '/tmp/opt-cpp-backend/run_cpp_backend.py',
            usrCod,
            useCPP ? 'cpp' : 'c');

  child_process.execFile(exeFile, args,
                         {timeout: TIMEOUT_SECS * 1000 /* milliseconds */,
                          maxBuffer: MAX_BUFFER_SIZE,
                          // SIGINT isn't as "strong" but docker seems
                          // to clean up containers better with it. the
                          // problem with SIGKILL is that containers
                          // don't seem to be properly cleaned up ...
                          killSignal: 'SIGKILL'},
                         postExecHandler.bind(null, res, useJSONP));
}


// https support
var https = require('https');
var fs = require('fs');

// to use low-numbered ports, Node must be allowed to bind to ports lower than 1024.
// e.g., run: sudo setcap 'cap_net_bind_service=+ep' <node executable>
// defaults:
var PORT = 80;
var useHttps = false;

var args = process.argv.slice(2);
if (args.length > 0) {
  if (args[0] === 'https') {
    PORT = 443;
    useHttps = true;
  } else if (args[0] === 'http3000') {
    PORT = 3000;
  } else if (args[0] === 'https8001') {
    PORT = 8001;
    useHttps = true;
  } else {
    assert(false);
  }
}

if (useHttps) {
  // added letsencrypt support on 2017-06-28 -- MAKE SURE we have read permissions
  var options = {
    key: fs.readFileSync('/etc/letsencrypt/live/cokapi.com/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/cokapi.com/cert.pem'),
    ca: fs.readFileSync('/etc/letsencrypt/live/cokapi.com/chain.pem')
  };

  var server = https.createServer(options, app).listen(
    PORT,
    function() {
      var host = server.address().address;
      var port = server.address().port;
      console.log('https app listening at https://%s:%s', host, port);
  });
} else {
  var server = app.listen(
    PORT,
    function() {
      var host = server.address().address;
      var port = server.address().port;
      console.log('http app listening at http://%s:%s', host, port);
  });
}
