'use strict'; // eslint-disable-line strict

const Promise = require('bluebird');
const amqplib = require('amqp-connection-manager');
const retry = require('amqplib-retry');
const uuid = require('node-uuid');

const setup = config => channel =>
  Promise.map(Object.keys(config.topicExchanges), topicExchangeName =>
    channel.assertExchange(
        topicExchangeName,
        'topic',
        config.topicExchanges[topicExchangeName].options))
  .then(() =>
    Promise.map(Object.keys(config.queues), queueName =>
      channel.assertQueue(queueName, config.queues[queueName].options)
      .then(() =>
        config.queues[queueName].bindToTopic ?
        channel.bindQueue(
          queueName,
          config.queues[queueName].bindToTopic.exchange,
          config.queues[queueName].bindToTopic.key) :
        Promise.resolve())))
    .then(() => config.prefetch ? channel.prefetch(config.prefetch) : null);

function AmqpClient(conf) {
  this.config = conf || {};
  this.conn = null;
  this.channel = null;
  this.connected = false;
}

AmqpClient.prototype.init = function init() {
  if (this.connected) {
    return Promise.resolve();
  }

  this.conn = amqplib.connect(this.config.rabbitMqUrl);
  this.connected = true;
  return new Promise((resolve) => this.conn.once('connect', resolve))
    .then(() => {
      this.channel = this.conn.createChannel({ setup: setup(this.config) });
      return this.channel;
    });
};

AmqpClient.prototype.close = function close() {
  if (!this.connected) return Promise.reject();
  this.connected = false;
  return this.channel.close().then(() => this.conn.close());
};

AmqpClient.prototype.consume = function consume(consumerQueue, failureQueue, handler, maxAttempts) {
  const channelWrapper = this.channel;
  let consumerTag;

  function consumeSetup(channel) {
    return channel.consume(
      consumerQueue,
      retry({
        channel,
        consumerQueue,
        failureQueue,
        handler,
        delay: (attempts) => maxAttempts && (attempts > maxAttempts - 1) ? 0 : attempts * 1.5 * 200
      })
    ).then(opts => {
      consumerTag = opts.consumerTag;
      return opts;
    });
  }

  function removeConsumer() {
    return channelWrapper.removeSetup(consumeSetup, channel => {
      if (consumerTag) {
        return channel.cancel(consumerTag);
      }
      return Promise.resolve();
    });
  }

  return this.channel.addSetup(consumeSetup)
    .then(() => removeConsumer);
};

AmqpClient.prototype.publish = function publish(ex, key, message, options) {
  const messageId = uuid.v4();
  const messageMeta = {
    messageId
  };
  if (options) messageMeta.persistent = options.persistent;
  if (this.channel.publish(ex, key, new Buffer(message), messageMeta)) {
    return Promise.resolve();
  }
  return Promise.reject();
};

module.exports = AmqpClient;
