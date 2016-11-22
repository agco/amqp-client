'use strict'; // eslint-disable-line strict

const Promise = require('bluebird');
const AmqpClient = require('../index');
const uuid = require('node-uuid');
const chai = require('chai');
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

describe('AmqpClient', () => {
  let client;

  beforeEach(() => {
    client = new AmqpClient(config);
    return client.init();
  });
  afterEach(() => {
    client.close();
  });

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
});

describe('AmqpClient - Failure Scenario', () => {
  const client = new AmqpClient(config);
  const client2 = new AmqpClient(config);

  before(() => {
    return client.init()
    .then(() => {
      return client2.init();
    });
  });

  after(() => {
    return client2.close();
  });

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
