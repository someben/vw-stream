# vw-stream

Online machine learning with [Vowpal Wabbit](https://vowpalwabbit.org/) as a Node.js stream. Write training or test examples in; read predictions, per-example loss, and a live model out, without ever stopping the learner.

I wrote this in 2015 to score streaming data with an online linear learner from inside a Node service. It is small (one file), and it still runs on current Node.

## Install

You need the `vw` binary on your `PATH` (or pass `vwBinPath`):

    sudo apt install vowpal-wabbit      # Debian / Ubuntu
    brew install vowpal-wabbit          # macOS

Then install vw-stream from GitHub:

    npm install github:someben/vw-stream

## Example

From the [Vowpal Wabbit tutorial](https://github.com/VowpalWabbit/vowpal_wabbit/wiki/Tutorial):

    const { VowpalWabbitStream } = require('vw-stream');

    const vw = new VowpalWabbitStream({ learningRate: 10 });
    vw.on('data', (obj) => {
        console.log('prediction', obj.pred, 'loss', obj.loss, 'avg loss', vw.getAverageLoss());
    });
    const exs = [
        { resp: 0, featMap: { price: 0.23, sqft: 0.25, age: 0.05, yr2006: 1.0 } },
        { resp: 1, imp: 2.0, featMap: { price: 0.18, sqft: 0.15, age: 0.35, yr1976: 1.0 } },
        { resp: 0, initPred: 0.5, featMap: { price: 0.53, sqft: 0.32, age: 0.87, yr1924: 1.0 } }
    ];
    for (let pass = 0; pass < 25; pass++) {
        exs.forEach((ex) => vw.write(ex));
    }
    vw.end();

Each example is a plain object:

- `resp`: the label.
- `imp`: importance weight (default 1).
- `initPred`: base prediction to learn a residual on (optional).
- `featMap`: features as `name: value`. A value of 1 is written as a bare feature; a value of 0 (or `null`) leaves the feature out. A nested object is a named namespace: `{ book: { bid: 0.2, ask: 0.3 }, trades: { n: 12 } }`.

Each `data` event is `{ pred, loss, ex, exNum }`. The prediction is made before VW learns from that example, so the running average loss is an honest progressive-validation (out-of-sample) estimate.

## Options

    new VowpalWabbitStream({
        lossFunction: 'squared',     // 'squared' | 'classic' | 'hinge' | 'logistic' | 'quantile'
        quantileTau: 0.5,            // with 'quantile'
        numBits: 18,                 // --bit_precision
        learningRate: 0.5,           // --learning_rate
        l1: 0, l2: 0,                // regularization
        randomSeed: 1,
        quadraticFeatures: [['book', 'trades']],   // --quadratic over named namespaces
        modelBuffer: previousModel,  // warm-start from a Buffer from getModel()
        vwBinPath: '/usr/local/bin/vw'
    });

## Live model

`vw.getModel((buf) => fs.writeFileSync('model.vw', buf))` asks the running VW process to save its regressor and hands you the bytes, while training continues. Pass that Buffer back as `modelBuffer` to resume training somewhere else.

## How it works

The stream spawns `vw` as a child process with `--predictions stdout`, writes each example in VW text format tagged `exNum_<n>`, and matches predictions back to examples by tag. Namespace names are mapped onto VW's single-character namespaces (`a` is the default; `b` to `z` are assigned in order of first use, so at most 25 named namespaces).

## Changes in 0.1.1 (2026)

- Zero-valued features are left out. Before, a feature with value 0 was written without a value, which VW reads as 1.

## Changes in 0.1.0 (2026)

- Runs on Node 18+: temp files are now removed with `fs.unlinkSync`. Before, `fs.unlink()` with no callback threw `ERR_INVALID_ARG_TYPE`; the logger's exception handler swallowed it, so `getModel()` never called back and the stream never ended.
- Quantile loss is reported correctly: `calcLoss` was called with prediction and label swapped, which exchanged `tau` and `1 - tau`. Squared, hinge, and logistic loss were not affected.

## Shout-outs

- To [driffer85](https://github.com/vivekkrbajpai/VowpalWabbit) for his earlier wrapper.

## License

MIT. Ben Gimpert: [blog.someben.com](https://blog.someben.com/) · [GitHub](https://github.com/someben) · [LinkedIn](https://www.linkedin.com/in/someben)
