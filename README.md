# vw-stream

Online machine learning with Vowpal Wabbit as Node.js streams.

## Features
- *Stream Abstraction:* Treat a Vowpal Wabbit learner process as a writable & readable stream. You write training or testing examples, and read predictions from the stream.
- *Sparse Example Format:* Represent your training or testing examples and observations naturally, as sparse JavaScript objects.
- *Namespace Mapping:* Use descriptive feature namespace names, which are mapped under-the-hood onto Vowpal Wabbit's preferred single-character namespace codes.
- *Live Model Persistence:* Retrieve the Vowpal Wabbit binary model ("regressor") during training or testing. You never need to shut-down the Vowpal Wabbit process!
- *Child, Not Daemon:* Uses a spawned child process for Vowpal Wabbit, for simpler interaction and IPC management.

## Example
From the [Vowpal Wabbit tutorial](https://github.com/JohnLangford/vowpal_wabbit/wiki/Tutorial):

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

## Shout-outs

- To [driffer85](https://github.com/vivekkrbajpai/VowpalWabbit) for his earlier wrapper.
