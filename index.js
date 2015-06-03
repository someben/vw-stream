#!/usr/bin/env node

var fs =      require('fs');
var spawn =   require('child_process').spawn;
var stream =  require('stream');
var util =    require('util');

var split =   require('split');
var temp =    require('temp').track();
var winston = require('winston');

var Logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({ level: 'debug', json: false, timestamp: true }),
        new winston.transports.File({  level: 'debug', filename: __dirname + '/debug.log', json: false })
    ],
    exceptionHandlers: [
        new (winston.transports.Console)({ json: false, timestamp: true }),
        new winston.transports.File({ filename: __dirname + '/exceptions.log', json: false })
    ],
    exitOnError: false
});


var Constants = {
    DEFAULT_NAMESPACE_CHAR: 'a',
    NAMESPACE_CHARS: 'bcdefghijklmnopqrstuvwxyz',
    SAVE_MODEL_EXAMPLE: -1,
    
    SQUARED_LOSS: 'squared',
    CLASSIC_LOSS: 'classic',
    HINGE_LOSS: 'hinge',
    LOGISTIC_LOSS: 'logistic',
    QUANTILE_LOSS: 'quantile'
};


function VowpalWabbitStream(conf) {
    stream.Readable.call(this);
    stream.Writable.call(this);
    var that = this;
    
    that._escapeVowpalWabbit = function(s) {
        return encodeURIComponent(s);  // use URI encoding to avoid conflicting with any of Vowpal Wabbit special characters (i.e. : or |)
    };
    
    that._namespaceMap = {};  // namespace name => Vowpal Wabbit namespace character (i.e. a)
    that._getNamespaceCharacter = function(namespaceName) {
        if (! namespaceName) {
            return Constants.DEFAULT_NAMESPACE_CHAR;
        }
        if (namespaceName in that._namespaceMap) {
            return that._namespaceMap[namespaceName];
        }
        var nsChar = Constants.NAMESPACE_CHARS.charAt(Object.keys(that._namespaceMap).length);
        if (! nsChar) {
            throw new Error("Too many namespaces");
        }
        return (that._namespaceMap[namespaceName] = nsChar);
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
    
    var vwArgs = [
        "--save_resume",
        "--bit_precision", that._conf.numBits,
        "--predictions", "stdout"  // Vowpal Wabbit supports "stdout" as a magic string (https://github.com/JohnLangford/vowpal_wabbit/blob/f7cf52ffb7d49bc689898739c59b308d33f5d8fb/vowpalwabbit/parse_args.cc#L691)
    ];
    
    vwArgs = vwArgs.concat(["--loss_function", that._conf.lossFunction]);
    if (that._conf.lossFunction == Constants.QUANTILE_LOSS) {
        vwArgs = vwArgs.concat(["--quantile_tau", this._conf.quantileTau]);
    }
    
    if (that._conf.model) {
        var modelPath = temp.path("vwStreamInitModel", 'f-');
        fs.writeFileSync(modelPath, that._conf.model);
        vwArgs = vwArgs.concat(["--initial_regressor", modelPath]);
    }
    
    if (that._conf.l1) {
        vwArgs = vwArgs.concat(["--l1", that._conf.l1]);
    }
    if (that._conf.l2) {
        vwArgs = vwArgs.concat(["--l2", that._conf.l2]);
    }
    
    if (that._conf.quadraticFeatures) {
        for (var quadPair in that._conf.quadraticFeatures) {
            var nsChar1 = that._getNamespaceCharacter(quadPair[0]);
            var nsChar2 = that._getNamespaceCharacter(quadPair[1]);
            vwArgs = vwArgs.concat(["--quadratic", nsChar1 + nsChar2]);
        }
    }
    
    Logger.debug("Launching VW child process:", vwArgs.join(' '));
    that._childProcess = spawn(that._conf.vwBinPath || 'vw', vwArgs);

    that._childProcess.stdout
        .pipe(split())
        .on('data', function (line) {
            Logger.debug("VW(STDOUT):", line);
            var re = line.match(/^(\S+)\s+exNum_(\S+)$/);
            if (! re) return;

            var predExNum = null;
            try {
                var pred = parseFloat(re[1]);
                predExNum = parseInt(re[2], 10);
                var ex = that._exMap[predExNum];
                var exLoss = that.calcLoss(pred, ex.resp);
    
                var predObj = {
                    pred: pred,
                    loss: exLoss,
                    ex: ex
                };
                that.push(predObj);
                that._lossSum += exLoss;
            }
            finally {
                if (predExNum) {
                    delete that._exMap[predExNum];
                }
            }
        });
        
    that._childProcess.stderr
        .pipe(split())
        .on('data', function (line) {
            Logger.debug("VW(STDERR):", line);
        });
        
    that._childProcess.on('exit', function(exitCode) {
        Logger.info("VW(exit):", exitCode);
        that.emit('end');
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
            if (typeof exFeatMap[featKey] === 'object') {
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
                vwEx += "|" + nsChar + " " + feats.join(" ");
            }
        }
        return vwEx;
    };
    
    that.on('data', function(ex) {
        that._numExamples++;
        var vwEx = that._toVowpalWabbitFormat(ex, that._numExamples);
        Logger.debug("VW(sendExample):", vwEx);
        that._exMap[that._numExamples] = ex;
        that._childProcess.stdin.write(vwEx + "\n");
    });
}
util.inherits(VowpalWabbitStream, stream.Readable);
util.inherits(VowpalWabbitStream, stream.Writable);

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
    var modelPath = temp.path("vwStreamModel", 'f-');
    this._childProcess.stdin.write("save_" + modelPath + "\n");
    fs.readFile(modelPath, 'utf8', function(err, data) {
        if (err) {
            Logger.error("Could not read model temporary file", modelPath);
        }
        else {
            fn(data);
        }
    });
};

exports.Constants = Constants;
exports.VowpalWabbitStream = VowpalWabbitStream;
