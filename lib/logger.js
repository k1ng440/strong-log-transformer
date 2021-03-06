// Copyright IBM Corp. 2014. All Rights Reserved.
// Node module: strong-log-transformer
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

var stream = require('stream');
var util = require('util');
var fs = require('fs');

var byline = require('byline');
var through = require('through');
var duplexer = require('duplexer');
var moment = require('moment');

module.exports = Logger;

Logger.DEFAULTS = {
  format: 'text',
  tag: '',
  mergeMultiline: false,
  timeStamp: false,
};

var formatters = {
  text: textFormatter,
  json: jsonFormatter,
}

function Logger(options) {
  var defaults = JSON.parse(JSON.stringify(Logger.DEFAULTS));
  options = util._extend(defaults, options || {});
  var catcher = new byline.LineStream;
  var emitter = catcher;
  var transforms = [
    objectifier(),
  ];

  if (options.tag) {
    transforms.push(staticTagger(options.tag));
  }

  if (options.mergeMultiline) {
    transforms.push(lineMerger());
  }

  // TODO
  // if (options.pidStamp) {
  //   transforms.push(pidStamper(options.pid));
  // }

  // TODO
  // if (options.workerStamp) {
  //   transforms.push(workerStamper(options.worker));
  // }

  transforms.push(formatters[options.format](options));

  // restore line endings that were removed by byline
  transforms.push(reLiner());

  for (var t in transforms) {
    emitter = emitter.pipe(transforms[t]);
  }

  return duplexer(catcher, emitter);
}

function reLiner() {
  return through(appendNewline);

  function appendNewline(line) {
    this.emit('data', line + '\n');
  }
}

function objectifier() {
  return through(objectify, null, {autoDestroy: false});

  function objectify(line) {
    this.emit('data', {
      msg: line,
      time: Date.now(),
    });
  }
}

function staticTagger(tag) {
  return through(tagger);

  function tagger(logEvent) {
    logEvent.tag = tag;
    this.emit('data', logEvent);
  }
}

function textFormatter(options) {
  return through(textify);

  function textify(logEvent) {
    var line = util.format('%s%s', textifyTags(logEvent.tag),
                           logEvent.msg.toString());
    if (options.timeStamp) {
      line = util.format('%s %s', moment(logEvent.time).toISOString(), line);
    }
    this.emit('data', line.replace(/\n/g, '\\n'));
  }

  function textifyTags(tags) {
    var str = '';
    if (typeof tags === 'string') {
      str = tags + ' ';
    } else if (typeof tags === 'object') {
      for (var t in tags) {
        str += t + ':' + tags[t] + ' ';
      }
    }
    return str;
  }
}

function jsonFormatter(options) {
  return through(jsonify);

  function jsonify(logEvent) {
    if (options.timeStamp) {
      logEvent.time = moment(logEvent.time).toISOString();
    } else {
      delete logEvent.time;
    }
    logEvent.msg = logEvent.msg.toString();
    this.emit('data', JSON.stringify(logEvent));
  }
}

function lineMerger(host) {
  var previousLine = null;
  var flushTimer = null;
  var stream = through(lineMergerWrite, lineMergerEnd);
  var flush = _flush.bind(stream);

  return stream;

  function lineMergerWrite(line) {
    if (/^\s+/.test(line.msg)) {
      if (previousLine) {
        previousLine.msg += '\n' + line.msg;
      } else {
        previousLine = line;
      }
    } else {
      flush();
      previousLine = line;
    }
    // rolling timeout
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush.bind(this), 10);
  }

  function _flush() {
    if (previousLine) {
      this.emit('data', previousLine);
      previousLine = null;
    }
  }

  function lineMergerEnd() {
    flush.call(this);
    this.emit('end');
  }
}
