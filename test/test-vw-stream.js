var VowpalWabbitStream = require('..').VowpalWabbitStream;

exports.testSomething = function(test){
    var vw = new VowpalWabbitStream();
    vw.on('data', function() {
        console.log("Prediction callback:", arguments);
    });
    
    vw.emit({
        resp: 1.0,
        featMap: {
            foo: 123,
            bar: null
        }
    });
    
    test.expect(1);
    test.ok(true, "this assertion should pass");
    test.done();
};
