'use strict'; // eslint-disable-line strict

const Promise = require('bluebird');
const AmqpClient = require('../index');
const uuid = require('node-uuid');
const chai = require('chai');
const $http = require('http-as-promised');
const expect = chai.expect;

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

function removeQueue(queueName) {
  return $http.del(`http://guest:guest@localhost:15672/api/queues/%2F/${queueName}`)
      .catch(err => {
        if (!err || err.statusCode !== 404) {
          throw err;
        }
      });
}

describe('AmqpClient', () => {
  const client = new AmqpClient(config);

  beforeEach(() => Promise.all([
    removeQueue('defaultWorkQueue'),
    removeQueue('defaultFailQueue'),
    removeQueue('amqplib-retry.delayed'),
    removeQueue('amqplib-retry.ready')
  ]).then(() => client.init().delay(100)));

  afterEach(() => client.close());

  it('produces and consumes messages', () => {
    const messageText = uuid.v4();
    const received = [];
    console.log('first test', messageText);

    return Promise.resolve(client.consume('defaultWorkQueue', 'defaultFailQueue', msg => {
      console.log('    Received message:', msg.content.toString());
      received.push(msg.content.toString());
    }))
      .then(() => {
        return client.publish('data.test', 'someKey', messageText);
      })
      .delay(500)
      .then(() => {
        expect(received.pop()).to.equal(messageText);
      });
  });

  it('retries messages on failure', () => {
    const messageText = uuid.v4();
    console.log('second test', messageText);

    const received = [];
    return Promise.resolve(client.consume('defaultWorkQueue', 'defaultFailQueue', msg => {
      console.log('    Received message:', msg.content.toString());
      received.push(msg.content.toString());
      if (received.length === 1) return Promise.reject(new Error('Force Retry'));
      return Promise.resolve();
    }))
    .then(() => {
      return client.publish('data.test', 'someKey', messageText);
    })
    .delay(500)
    .then(() => {
      expect(received.pop()).to.equal(messageText);
    });
  });

  it('should be able to stop consuming without disconnecting', () => {
    const messages = [];
    let disconnectConsumer1;
    return Promise.resolve()
      .then(() => client.consume('defaultWorkQueue', 'defaultFailQueue', (msg) => messages.push(msg), 1))
      .then(result => {
        disconnectConsumer1 = result;
      })
      .then(() => client.publish('', 'defaultWorkQueue', new Buffer('1'))).delay(100)
      .then(() => disconnectConsumer1())
      .then(() => client.publish('', 'defaultWorkQueue', new Buffer('2'))).delay(500)
      .then(() => {
        expect(messages.length).to.equal(1);
        expect(messages[0].content.toString()).to.equal('1');
      })
      .then(() => client.consume('defaultWorkQueue', 'defaultFailQueue', (msg) => messages.push(msg), 1))
      .delay(500)
      .then(() => {
        expect(messages.length).to.equal(2);
        expect(messages[0].content.toString()).to.equal('1');
        expect(messages[1].content.toString()).to.equal('2');
      });
  });
});

describe('AmqpClient - Failure Scenario', () => {
  const client = new AmqpClient(config);
  const client2 = new AmqpClient(config);

  before(() => {
    return client.init()
    .then(() => {
      return client2.init();
    }).delay(100);
  });

  after(() => client2.close());

  it('should produce and consume messages, and retry messages on failure', () => {
    const messageText = uuid.v4();
    console.log('third test', messageText);
    const received = [];

    const consumerPromise = client.consume('defaultWorkQueue', 'defaultFailQueue', (msg) => {
      console.log('    Client 1 Received message:', msg.content.toString());
      console.log('    Killing client 1 before processing...');
      client.close();
    });

    const publisherPromise = client.publish('data.test', 'someOtherKey', messageText);

    return Promise.all([consumerPromise, publisherPromise])
    .delay(500)
    .then(() =>
      client2.consume('defaultWorkQueue', 'defaultFailQueue', (msg) => {
        console.log('    Received message:', msg.content.toString());
        expect(msg.content.toString()).to.equal(messageText);
        received.push(msg.content.toString());
      }))
    .then(() => {
      expect(received.pop()).to.equal(messageText);
    });
  });
});


describe('AmqpClient - Failure Scenario', () => {
  const client = new AmqpClient(config);

  /* delay to wait for queues to be created*/
  before(() => client.init().delay(100));

  after(() => client.close());

  describe('when maxAttempts is provided and message was rejected that many times', () => {
    it('should move message to failure queue', () => {
      let attempts = 0;
      let failQueueMessages = 0;
      const messageText = uuid.v4();
      const maxAttempts = 3;
      return Promise.resolve()
        .then(() => client.consume('defaultWorkQueue', 'defaultFailQueue',
          () => Promise.reject(`Fail always: ${attempts++}`), maxAttempts))
        .then(() => client.publish('data.test', 'someOtherKey', messageText))
        .delay(5000)
        .then(() => expect(attempts).to.equal(maxAttempts))
        .then(() => client.consume('defaultFailQueue', 'defaultFailQueue', () => failQueueMessages++, 1))
        .delay(100)
        .then(() => expect(failQueueMessages).to.equal(1));
    });
  });
});

describe('init', () => {
  describe('when queues do not exist', () => {
    let client;

    before(() => {
      client = new AmqpClient(config);
    });

    after(() => client && client.close());

    it('should wait until queues are created before resolving', () => {
      return Promise.resolve()
        .then(() => client.init())
        .then(() => Promise.all([
          new Promise(resolve => client.consume('defaultWorkQueue', 'defaultFailQueue', resolve, 1)),
          Promise.resolve().then(() => client.publish('', 'defaultWorkQueue', 'abc')).delay(100)
        ]));
    });
  });
});
