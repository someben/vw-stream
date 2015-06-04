#!/usr/bin/env node

var Logger = require('..').Logger;
var VowpalWabbitStream = require('..').VowpalWabbitStream;

function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
};

function assertEqualish(test, actual, expected, tol, message) {
    if (((expected == null) && (actual != null))          ||
        (isNaN(expected) && (! isNaN(actual)))            ||
        ((! isFinite(expected)) && (actual != expected))  ||
        (! isFinite(actual))) {
        test.fail(actual, expected, message, '==');
        return;
    }

    var checkedTol = (typeof(tol) == 'undefined') ? 0.01 : tol;
    if (Math.abs(actual - expected) > checkedTol) {
        test.fail(actual, expected, message, '==');
    }
    else {
        test.ok(true, message);  // for the expect(n) count
    }
}

var exDataRows = [
    { boxOffice: 85.09999847, prodCost: 8.5, promCost: 5.099999905, bookSales: 4.699999809 },
    { boxOffice: 106.3000031, prodCost: 12.89999962, promCost: 5.800000191, bookSales: 8.800000191 },
    { boxOffice: 50.20000076, prodCost: 5.199999809, promCost: 2.099999905, bookSales: 15.10000038 },
    { boxOffice: 130.6000061, prodCost: 10.69999981, promCost: 8.399998665, bookSales: 12.19999981 },
    { boxOffice: 54.79999924, prodCost: 3.099999905, promCost: 2.900000095, bookSales: 10.60000038 },
    { boxOffice: 30.29999924, prodCost: 3.5, promCost: 1.200000048, bookSales: 3.5 },
    { boxOffice: 79.40000153, prodCost: 9.199999809, promCost: 3.700000048, bookSales: 9.699999809 },
    { boxOffice: 91, prodCost: 9, promCost: 7.599999905, bookSales: 5.900000095 },
    { boxOffice: 135.3999939, prodCost: 15.10000038, promCost: 7.699999809, bookSales: 20.79999924 },
    { boxOffice: 89.30000305, prodCost: 10.19999981, promCost: 4.5, bookSales: 7.900000095 }
];

function getTestExamples(namespaceName) {
    var exs = [];
    for (var i=0; i < exDataRows.length; i++) {
        var exDataRow = clone(exDataRows[i]);
        var ex = { resp: exDataRow.boxOffice };
        var exFeatMap = exDataRow;
        delete exFeatMap.boxOffice;
        if (typeof(namespaceName) == 'undefined') {
            ex.featMap = exFeatMap;
        }
        else {
            ex.featMap = {};
            ex.featMap[namespaceName] = exFeatMap;
        }
        exs.push(ex);
    }
    return exs;
}

exports.testVowpalWabbitFormat = function(test) {
    test.expect(7);
    var ex = getTestExamples()[0];
    var vw = new VowpalWabbitStream();
    
    test.equal(vw._toVowpalWabbitFormat(ex), "85.09999847 1 |a prodCost:8.5 promCost:5.099999905 bookSales:4.699999809");
    test.equal(vw._toVowpalWabbitFormat(ex, 123), "85.09999847 1 'exNum_123 |a prodCost:8.5 promCost:5.099999905 bookSales:4.699999809");

    ex.featMap.prodCost = 1;  // default feature value in VW
    test.equal(vw._toVowpalWabbitFormat(ex, 123), "85.09999847 1 'exNum_123 |a prodCost promCost:5.099999905 bookSales:4.699999809");
    
    ex.imp = 2.5;
    test.equal(vw._toVowpalWabbitFormat(ex, 123), "85.09999847 2.5 'exNum_123 |a prodCost promCost:5.099999905 bookSales:4.699999809");
    
    ex.imp = 0;  // i.e. just testing, not training
    test.equal(vw._toVowpalWabbitFormat(ex, 123), "85.09999847 0 'exNum_123 |a prodCost promCost:5.099999905 bookSales:4.699999809");
    
    ex.featMap['anotherNamespace'] = { foo: 123, bar: -2.34 };
    test.equal(vw._toVowpalWabbitFormat(ex, 123), "85.09999847 0 'exNum_123 |a prodCost promCost:5.099999905 bookSales:4.699999809 |b foo:123 bar:-2.34");

    ex.initPred = 0.5;
    test.equal(vw._toVowpalWabbitFormat(ex, 123), "85.09999847 0 0.5 'exNum_123 |a prodCost promCost:5.099999905 bookSales:4.699999809 |b foo:123 bar:-2.34");

    vw.end();
    test.done();
};

exports.testOnePrediction = function(test) {
    test.expect(1);
    var vw = new VowpalWabbitStream();
    
    vw.on('data', function(predObj) {
        test.ok(predObj.pred >= 0);
        test.done();
    });

    vw.write({
        resp: 1.0,
        featMap: {
            foo: 123,
            bar: null
        }
    });
    vw.end();
};

exports.testPrediction = function(test) {
    test.expect(1);
    var exs = getTestExamples();
    var vw = new VowpalWabbitStream();
    
    vw.on('end', function() {
        assertEqualish(test, vw.getAverageLoss(), 7906.92);
        test.done();
    });

    for (var i=0; i < exs.length; i++) {
        vw.write(exs[i]);
    }
    vw.end();
};

exports.testPredictionPasses = function(test) {
    test.expect(1);
    var exs = getTestExamples();
    var vw = new VowpalWabbitStream();
    
    vw.on('end', function() {
        assertEqualish(test, vw.getAverageLoss(), 7312.20);  // loss has decreased with more training passes
        test.done();
    });

    for (var passNum = 1; passNum <= 5; passNum++) {
        for (var i=0; i < exs.length; i++) {
            vw.write(exs[i]);
        }
    }
    vw.end();
};

exports.testPredictionPassesInteractions = function(test) {
    test.expect(1);
    var ns = "testNamespace";
    var exs = getTestExamples(ns);
    var vw = new VowpalWabbitStream({
        quadraticFeatures: [[ns, ns]]
    });
    
    vw.on('end', function() {
        assertEqualish(test, vw.getAverageLoss(), 6932.21);  // loss has decreased with interaction terms
        test.done();
    });

    for (var passNum = 1; passNum <= 5; passNum++) {
        for (var i=0; i < exs.length; i++) {
            vw.write(exs[i]);
        }
    }
    vw.end();
};

exports.testPredictionModel = function(test) {
    test.expect(1);
    var exs = getTestExamples();
    var vw = new VowpalWabbitStream();
    
    vw.on('end', function() {
        vw.getModel(function(modelBuffer) {
            test.ok(modelBuffer.length > 0);
            test.done();
            vw.end();
        });
    });

    for (var i=0; i < exs.length; i++) {
        vw.write(exs[i]);
    }
    vw.end();
};

exports.testPredictionModelRestart = function(test) {
    test.expect(1);
    var exs = getTestExamples();
    var vw1 = new VowpalWabbitStream();

    vw1.on('end', function(predObj) {
        vw1.getModel(function(model) {
            var vw2 = new VowpalWabbitStream({
                modelBuffer: model
            });

            vw2.on('end', function() {
                assertEqualish(test, vw2.getAverageLoss(), 6844.05);
                test.done();
            });

            for (var i=0; i < exs.length; i++) {  // train w/ the fifth pass
                vw2.write(exs[i]);
            }
            vw2.end();
        });
    });

    for (var passNum = 1; passNum <= 4; passNum++) {
        for (var i=0; i < exs.length; i++) {
            vw1.write(exs[i]);
        }
    }
    vw1.end();
};

exports.testPredictionLiveModel = function(test) {
    test.expect(1);
    var exs = getTestExamples();
    var vw = new VowpalWabbitStream();
    
    vw.on('data', function(predObj) {
        if (predObj.exNum == Math.floor(exs.length / 2)) {
            vw.getModel(function(model) {
                test.ok(model.length > 0);
                test.done();
                vw.end();
            });
        }
    });

    for (var i=0; i < exs.length; i++) {
        vw.write(exs[i]);
    }
};

exports.testPredictionLiveModelRestart = function(test) {
    test.expect(1);
    var exs = getTestExamples();
    var vw1 = new VowpalWabbitStream();

    vw1.on('data', function(predObj) {
        if (predObj.exNum == (4 * exs.length)) {  // last example
            vw1.getModel(function(model) {
                vw1.end();

                var vw2 = new VowpalWabbitStream({
                    modelBuffer: model
                });

                vw2.on('end', function() {
                    assertEqualish(test, vw2.getAverageLoss(), 6844.05);
                    test.done();
                });

                for (var i=0; i < exs.length; i++) {  // train w/ the fifth pass
                    vw2.write(exs[i]);
                }
                vw2.end();
            });
        }
    });

    for (var passNum = 1; passNum <= 4; passNum++) {
        for (var i=0; i < exs.length; i++) {
            vw1.write(exs[i]);
        }
    }
};

exports.testReadmeExample = function(test) {
    ///////////////////////////////////////////////////////
    var vw = new VowpalWabbitStream({ learningRate: 10 });
    vw.on('data', function(obj) {
        console.log("Prediction & Average Loss:", obj.ex, obj.pred, vw.getAverageLoss());
    });
    var exs = [
        { resp: 0, featMap: { price: 0.23, sqft: 0.25, age: 0.05, yr2006: 1.0 } },
        { resp: 1, imp: 2.0, featMap: { price: 0.18, sqft: 0.15, age: 0.35, yr1976: 1.0 } },
        { resp: 0, initPred: 0.5, featMap: { price: 0.53, sqft: 0.32, age: 0.87, yr1924: 1.0 } }
    ];
    for (var pass=0; pass < 25; pass++) {
        for (var i=0; i < exs.length; i++) {
            vw.write(exs[i]);
        }
    }
    vw.end();
    /*
    [20150604@15:30:24.893] DEBUG -- VW(STDERR): finished run
    [20150604@15:30:24.893] DEBUG -- VW(STDERR): number of examples per pass = 75
    ...
    [20150604@15:30:24.894] DEBUG -- VW(STDERR): average loss = 0.057188
    */
    ///////////////////////////////////////////////////////
    test.done();
};
