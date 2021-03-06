const Promise = require('bluebird');
const AmqpClient = require('../index');
const uuid = require('node-uuid');
const chai = require('chai');
chai.should();

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
  const client = new AmqpClient(config);

  before(() => {
    return client.init();
  });

  after(() => {
    return client.close();
  });

  it('should produce and consume messages, and retry messages on failure', () => {
    const messageText = uuid.v4();
    const received = [];
    return client.consume('defaultWorkQueue', 'defaultFailQueue', (msg) => {
      console.log('    Received message:', msg.content.toString());
      received.push(msg.content.toString());
      if (received.length === 1) return Promise.reject(new Error('Force Retry'));
      return Promise.resolve();
    })
    .then(() => {
      return client.publish('data.test', 'someKey', messageText, {
        persistent: true,
        headers: {
          cause: 'badFrame'
        }
      });
    }).then(() => {
      return Promise
        .delay(500)
        .then(() => {
          (received[1]).should.equal(messageText);
          return Promise.resolve();
        });
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

  it('should produce and consume messages, and retry messages on failure', (done) => {
    const messageText = uuid.v4();
    const received = [];
    client.consume('defaultWorkQueue', 'defaultFailQueue', (msg) => {
      console.log('    Client 1 Received message:', msg.content.toString());
      console.log('    Killing client 1 before processing...');
      client.close();
    });

    client.publish('data.test', 'someOtherKey', messageText);

    setTimeout(() => {
      client2.consume('defaultWorkQueue', 'defaultFailQueue', (msg) => {
        console.log('    Received message:', msg.content.toString());
        (msg.content.toString()).should.equal(messageText);
        received.push(msg.content.toString());
        return Promise.resolve();
      });
    }, 500);

    setTimeout(() => {
      received[0].should.equal(messageText);
      done();
    }, 2000);
  });
});
