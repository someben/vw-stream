var VowpalWabbitStream = require('..').VowpalWabbitStream;

exports.testPrediction = function(test) {
    var vw = new VowpalWabbitStream();
    vw.on('data', function(predObj) {
        test.ok(predObj.pred >= 0);
        test.done();
    });

    test.expect(1);
    vw.write({
        resp: 1.0,
        featMap: {
            foo: 123,
            bar: null
        }
    });
    vw.end();
};
