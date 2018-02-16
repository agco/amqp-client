const Promise = require('bluebird');
const amqplib = require('amqplib');
const retry = require('amqplib-retry');
const uuid = require('node-uuid');

function AmqpClient(conf) {
  this.config = conf || {};
  this.conn = null;
  this.channel = null;
  this.connected = false;
}

AmqpClient.prototype.init = function init() {
  if (this.connected) return Promise.resolve();
  return Promise
    .resolve(amqplib.connect(this.config.rabbitMqUrl))
    .then((conn) => {
      this.conn = conn;
      this.connected = true;
      return this.conn.createChannel();
    })
    .tap((channel) => {
      this.channel = channel;
      const promises = [];
      Object.keys(this.config.topicExchanges).forEach((topicExchangeName) => {
        promises.push(
          channel.assertExchange(
            topicExchangeName,
            'topic',
            this.config.topicExchanges[topicExchangeName].options)
        );
      });
      return Promise.all(promises);
    })
    .then(() => {
      const promises = [];
      Object.keys(this.config.queues).forEach((queueName) => {
        promises.push(
          this.channel.assertQueue(
            queueName,
            this.config.queues[queueName].options
          )
        );
        if (this.config.queues[queueName].bindToTopic) {
          promises.push(
            this.channel.bindQueue(
              queueName,
              this.config.queues[queueName].bindToTopic.exchange,
              this.config.queues[queueName].bindToTopic.key
            )
          );
        }
      });
      return Promise.all(promises);
    });
};

AmqpClient.prototype.close = function close() {
  if (!this.connected) return Promise.reject();
  this.connected = false;
  return Promise.resolve(this.channel.close());
};

AmqpClient.prototype.consume = function consume(consumerQueue, failureQueue, handler) {
  return this.channel.consume(consumerQueue, retry({
    channel: this.channel,
    consumerQueue,
    failureQueue,
    handler,
    delay: (attempts) => {
      return attempts * 1.5 * 200;
    }
  }));
};

AmqpClient.prototype.publish = function publish(ex, key, message, options) {
  const messageId = uuid.v4();
  const messageMeta = {
    messageId,
    persistent: options && options.persistent,
    headers: options && options.headers
  };
  if (this.channel.publish(ex, key, new Buffer(message), messageMeta)) {
    return Promise.resolve();
  }
  return Promise.reject();
};

module.exports = AmqpClient;
