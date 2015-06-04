# vw-stream

Online machine learning with Vowpal Wabbit as Node.js streams.

## Features
- *Stream Abstraction:* Treat a Vowpal Wabbit learner process as a writable & readable stream. You write training or testing examples, and read predictions from the stream.
- *Sparse Example Format:* Represent your training or testing examples and observations naturally, as sparse JavaScript objects.
- *Namespace Mapping:* Use descriptive feature namespace names, which are mapped under-the-hood onto Vowpal Wabbit's preferred single-character namespace codes.
- *Live Model Persistence:* Retrieve the Vowpal Wabbit binary model ("regressor") during training or testing. You never need to shut-down the Vowpal Wabbit process!
- *Child, Not Daemon:* Uses a spawned child process for Vowpal Wabbit, for simpler interaction and IPC management.

## Shout-outs

- To [driffer85](https://github.com/vivekkrbajpai/VowpalWabbit) for his earlier wrapper.
