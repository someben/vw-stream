#!/usr/bin/env node

require('datejs');
var fs =      require('fs');
var spawn =   require('child_process').spawn;
var stream =  require('stream');
var util =    require('util');

var split =   require('split');
var temp =    require('temp').track();
var winston = require('winston');

var Logger = (function() {
    var logLevel = 'debug';
    var logFormatter = function(args) {
        var date = new Date();
        var timestamp = date.toString('yyyyMMdd@HH:mm:ss');
        timestamp += '.' + String('000' + date.getMilliseconds()).slice(-3);
        return "[" + timestamp + "] " + String('     ' + args.level.toUpperCase()).slice(-5) + " -- " + args.message;
    }
    
    return new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({ level: logLevel, formatter: logFormatter, json: false, timestamp: true }),
            new (winston.transports.File)({ level: logLevel, formatter: logFormatter, json: false, timestamp: true, filename: __dirname + '/console.log' })
        ],
        exceptionHandlers: [
            new (winston.transports.Console)({ formatter: logFormatter, json: false, timestamp: true }),
            new (winston.transports.File)({ formatter: logFormatter, json: false, timestamp: true, filename: __dirname + '/console_exceptions.log' })
        ],
        exitOnError: false
    });
})();


var Constants = {
    DEFAULT_NAMESPACE_CHAR: 'a',
    NAMESPACE_CHARS: 'bcdefghijklmnopqrstuvwxyz',

    SQUARED_LOSS: 'squared',
    CLASSIC_LOSS: 'classic',
    HINGE_LOSS: 'hinge',
    LOGISTIC_LOSS: 'logistic',
    QUANTILE_LOSS: 'quantile'
};


function VowpalWabbitStream(conf) {
    stream.Readable.call(this, { objectMode: true });
    stream.Writable.call(this, { objectMode: true });
    var that = this;
    
    that._escapeVowpalWabbit = function(s) {
        return encodeURIComponent(s);  // use URI encoding to avoid conflicting with any of Vowpal Wabbit special characters (i.e. : or |)
    };
    
    that._namespaceMap = {};  // namespace name => Vowpal Wabbit namespace character (i.e. a)
    that._getNamespaceCharacter = function(namespaceName) {
        if (typeof(namespaceName) == 'undefined') {
            return Constants.DEFAULT_NAMESPACE_CHAR;
        }
        if (namespaceName in that._namespaceMap) {
            return that._namespaceMap[namespaceName];
        }
        var nsChar = Constants.NAMESPACE_CHARS.charAt(Object.keys(that._namespaceMap).length);
        if (! nsChar) {
            throw new Error("Too many namespaces");
        }
        Logger.debug("Mapping '" + namespaceName + "' namespace to '" + nsChar + "' character.");
        that._namespaceMap[namespaceName] = nsChar;
        return nsChar;
    };

    that._conf = (typeof(conf) == 'undefined') ? {} : conf;
    that._conf.lossFunction = (typeof(that._conf.lossFunction) == 'undefined') ? Constants.SQUARED_LOSS : that._conf.lossFunction;
    if (that._conf.lossFunction == Constants.QUANTILE_LOSS) {
        that._conf.quantileTau = (typeof(that._conf.quantileTau) == 'undefined') ? 0.5 : that._conf.quantileTau;
    }
    that._conf.numBits = (typeof(that._conf.numBits) == 'undefined') ? 18 : that._conf.numBits;
    
    that._numExamples = 0;
    that._lossSum = 0;
    that._exMap = {};  // holds just those examples for which we are waiting a prediction
    
    that._finalModelPath = temp.path("vwStreamFinalModel", 'f-');
    that._finalModelBuffer = null;
    var vwArgs = [
        "--bit_precision", that._conf.numBits,
        "--final_regressor", that._finalModelPath,
        "--predictions", "stdout"  // Vowpal Wabbit supports "stdout" as a magic string (https://github.com/JohnLangford/vowpal_wabbit/blob/f7cf52ffb7d49bc689898739c59b308d33f5d8fb/vowpalwabbit/parse_args.cc#L691)
    ];
    
    vwArgs = vwArgs.concat(["--loss_function", that._conf.lossFunction]);
    if (that._conf.lossFunction == Constants.QUANTILE_LOSS) {
        vwArgs = vwArgs.concat(["--quantile_tau", this._conf.quantileTau]);
    }
    
    that._initModelPath = null;
    if (that._conf.modelBuffer) {
        that._initModelPath = temp.path("vwStreamInitModel", 'f-');
        Logger.verbose("Writing initialization model to temporary file:", that._initModelPath);
        fs.writeFileSync(that._initModelPath, that._conf.modelBuffer);
        vwArgs = vwArgs.concat(["--initial_regressor", that._initModelPath]);
    }
    
    if (that._conf.l1) {
        vwArgs = vwArgs.concat(["--l1", that._conf.l1]);
    }
    if (that._conf.l2) {
        vwArgs = vwArgs.concat(["--l2", that._conf.l2]);
    }
    
    if (that._conf.quadraticFeatures) {
        for (var i=0; i < that._conf.quadraticFeatures.length; i++) {
            var quadPair = that._conf.quadraticFeatures[i];
            var nsChar1 = that._getNamespaceCharacter(quadPair[0]);
            var nsChar2 = that._getNamespaceCharacter(quadPair[1]);
            vwArgs = vwArgs.concat(["--quadratic", nsChar1 + nsChar2]);
        }
    }
    
    Logger.debug("Launching VW child process:", vwArgs.join(' '));
    that._isChildProcessAlive = true;
    that._childProcess = spawn(that._conf.vwBinPath || 'vw', vwArgs);

    that._checkEnd = function() {
        if ((! that._isChildProcessAlive) && (Object.keys(that._exMap).length == 0)) {
            Logger.debug("VW(end)");
            that.emit('end');
        }
    };
    
    that._childProcess.stdout
        .pipe(split())
        .on('data', function (line) {
            var re = line.match(/^(\S+)\s+exNum_(\S+)$/);
            if (re) {
                var pred = parseFloat(re[1]);
                var predExNum = parseInt(re[2], 10);
                var ex = that._exMap[predExNum];
                var exLoss = that.calcLoss(pred, ex.resp);
                that._lossSum += exLoss;
    
                var predObj = {
                    pred: pred,
                    loss: exLoss,
                    ex: ex,
                    exNum: predExNum
                };
                that.emit('data', predObj);
                if (predExNum) {
                    delete that._exMap[predExNum];
                }
                that._checkEnd();
            }
            else {
                Logger.debug("VW(STDOUT):", line);
            }
        });
        
    that._childProcess.stderr
        .pipe(split())
        .on('data', function (line) {
            Logger.debug("VW(STDERR):", line);
        });
        
    that._childProcess.on('exit', function(exitCode) {
        Logger.info("VW(exit):", exitCode);

        if (that._initModelPath) {
            fs.unlink(that._initModelPath);
        }
        that._finalModelBuffer = fs.readFileSync(that._finalModelPath);
        fs.unlink(that._finalModelPath);

        that._isChildProcessAlive = false;
        that._checkEnd();
    });
    
    that._toVowpalWabbitFormat = function(ex, exNum) {
        var vwEx = "" + (ex.resp || 0);
        if (ex.imp) {
            vwEx += " " + ex.imp;
        }
        vwEx += " 'exNum_" + exNum;
        
        var exFeatMap = ex.featMap || {};
        var nsFeatMapMap = {};
        for (var featKey in exFeatMap) {
            if (exFeatMap[featKey] && (typeof exFeatMap[featKey] === 'object')) {
                // namespace
                var namespaceChar = that._getNamespaceCharacter(featKey);
                if (! (namespaceChar in nsFeatMapMap)) {
                    nsFeatMapMap[namespaceChar] = {};
                }
                for (var subFeatKey in exFeatMap[featKey]) {
                    nsFeatMapMap[namespaceChar][subFeatKey] = exFeatMap[featKey][subFeatKey];
                }
            }
            else {
                // default namespace
                var defNamespaceChar = that._getNamespaceCharacter();
                if (! (defNamespaceChar in nsFeatMapMap)) {
                    nsFeatMapMap[defNamespaceChar] = {};
                }
                nsFeatMapMap[defNamespaceChar][featKey] = exFeatMap[featKey];
            }
        }
        
        for (var nsChar in nsFeatMapMap) {
            var feats = [];
            for (var featKey in nsFeatMapMap[nsChar]) {
                var featVal = nsFeatMapMap[nsChar][featKey];
                var feat = that._escapeVowpalWabbit(featKey);
                if (featVal) {
                    feat += ":" + that._escapeVowpalWabbit(featVal);
                }
                feats.push(feat);
            }
            if (feats.length > 0) {
                vwEx += " |" + nsChar + " " + feats.join(" ");
            }
        }
        return vwEx;
    };
}
util.inherits(VowpalWabbitStream, stream.Readable);
util.inherits(VowpalWabbitStream, stream.Writable);

VowpalWabbitStream.prototype._write = function(ex, encoding, fn) {
    if (! this._isChildProcessAlive) {
        throw new Error("Attempt to send example to closed VW process");
    }
    this._numExamples++;
    var vwEx = this._toVowpalWabbitFormat(ex, this._numExamples);
    this._exMap[this._numExamples] = ex;
    Logger.debug("VW(sendExample):", vwEx);
    this._childProcess.stdin.write(vwEx + "\n");
    fn();
};

VowpalWabbitStream.prototype.end = function() {
    this._childProcess.stdin.end();
};

VowpalWabbitStream.prototype.calcLoss = function(resp, pred) {
    switch (this._conf.lossFunction) {
    case Constants.SQUARED_LOSS:
    case Constants.CLASSIC_LOSS:
        return (resp - pred) * (resp - pred);
        
    case Constants.HINGE_LOSS:
        return Math.max(0, 1 - (resp * pred));
        
    case Constants.LOGISTIC_LOSS:
        return Math.log(1 + Math.exp(-resp * pred));

    case Constants.QUANTILE_LOSS:
        var resid = resp - pred;
        if (resid > 0) {
            return this._conf.quantileTau * resid;
        }
        else {
            return -(1 - this._conf.quantileTau) * resid;
        }

    default:
        throw new Error("Unrecognized loss function: " + this._conf.lossFunction);
    }
};

VowpalWabbitStream.prototype.getAverageLoss = function() {
    return this._lossSum / this._numExamples;
};

VowpalWabbitStream.prototype.getModel = function(fn) {
    if (this._finalModelBuffer) {  // training in progress?
        fn(this._finalModelBuffer);
    }
    
    var modelPath = temp.path("vwStreamModel", 'f-');
    Logger.debug("Saving live model file:", modelPath);
    var vwEx = "save_" + modelPath;
    Logger.debug("VW(sendExample,save):", vwEx);
    this._childProcess.stdin.write(vwEx + "\n");
    
    // Vowpal Wabbit will write the model file "later", so poll the file system:
    var modelWriteTimeout = 2500;
    var checkModelStart = new Date();
    var checkModel = function() {
        if (fs.existsSync(modelPath)) {
            var modelBuffer = fs.readFileSync(modelPath);
            Logger.verbose("Read model from temporary file:", modelPath);
            fs.unlink(modelPath);
            fn(modelBuffer);
        }
        else {
            var checkModelNow = new Date();
            if ((checkModelNow.getTime() - checkModelStart.getTime()) > modelWriteTimeout) {
                throw new Error("Vowpal Wabbit never saved live model");
            }
            else {
                setTimeout(checkModel, 100);
            }
        }
    };
    checkModel();
};

exports.Logger = Logger;
exports.Constants = Constants;
exports.VowpalWabbitStream = VowpalWabbitStream;
