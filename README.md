[![Build Status](https://img.shields.io/travis/agco/amqp-client.svg?branch=master&style=flat-square)](https://travis-ci.org/agco/amqp-client)
[![Coverage Status](https://img.shields.io/coveralls/agco/amqp-client.svg?style=flat-square)](https://coveralls.io/r/agco/amqp-client)

# AMQP Client

A node module for amqp consumers and producers

## Config

Provide a config in the following format. The queues object must contain at least 1 queue for a producer, and at least 2 queues for a consumer. This is because, for each queue that a consumer is bound to, must also have a failure queue for retries.

```
const config = {
  rabbitMqUrl: 'amqp://guest:guest@localhost:5672',
  topicExchanges: {
    'data.test': {
      options: {
        durable: true
      }
    }
  },
  queues: {
    defaultWorkQueue: {
      options: {
        durable: true
      },
      bindToTopic: {
        exchange: 'data.test',
        key: '*'
      }
    },
    defaultFailQueue: {
      options: {
        durable: true
      }
    }
  }
};
```

## Use

Publishers:
```
const client = new AmqpClient(config);

client.init()
.then(() => {
    return client.publish('data.test', 'someKey', messageText);
})
```

Consumers:
```
const client = new AmqpClient(config);

const Promise = require('bluebird');

const messageHandler = (msg) => {
  console.log(msg.content.toString());
  // must return a promise to resolve or reject message!
  return Promise.resolve();
};

client.init()
.then(() => {
    return client.consume('defaultWorkQueue', 'defaultFailQueue', messageHandler);
})
```

## Testing
```
npm test
```
