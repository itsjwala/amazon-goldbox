const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const { getObject, copyObject, putObject } = require('./lib/aws');
const Product = require('./lib/product');

const Util = require('./lib/util');

const PROCESS_LABEL = '[SSE] Build';
const FEEDS_PATH = process.env.feeds_path;
const ACTIVE_PATH = process.env.active_path;

module.exports.rss = function (event, context) {

  getActiveFeed()
    .then(checkItemsStatus)
    .then(mapActiveItemsToProducts)
    .then(getNewFeedItemAndSave)
    .then(_ => {
      console.log(`${PROCESS_LABEL} - Success`);
      context.succeed()
    })
    .catch(error => {
      console.log(`${PROCESS_LABEL} - Error: ${error.toString()}`);
      context.fail()
    })

}


/**
 * getActiveFeed
 * @description
 */

function getActiveFeed() {

  return new Promise((resolve, reject) => {
    getObject(ACTIVE_PATH)
      .then(Util.parseObjectToJson)
      .then(resolve)
      .catch(reject)
  })

}


/**
 * mapActiveItemsToProducts
 * @description
 */

function mapActiveItemsToProducts(data) {

  console.log(`${PROCESS_LABEL} - Mapping items to products`);

  const feed_items = data.items.map(item => {

    const product = new Product();

    return product.setupItemFromStorage(item);

  });

  return {
    ...data,
    items: feed_items,
  };

}


/**
 * checkItemsStatus
 * @description
 */

function checkItemsStatus(data) {

  console.log(`${PROCESS_LABEL} - Checking items status`);

  if (Array.isArray(data.items) && data.items.length > 0) {
    console.log(`${PROCESS_LABEL} - Found items`);
    return data;
  }

  console.log(`${PROCESS_LABEL} - Copying Feeds: No items are available, refreshing data.`);

  return new Promise((resolve, reject) => {
    copyObject(ACTIVE_PATH, FEEDS_PATH)
      .then(getActiveFeed)
      .then(resolve)
      .catch(reject)
  });

}


/**
 * getNewFeedItemAndSave
 * @description
 */

async function getNewFeedItemAndSave(data) {

  console.log(`${PROCESS_LABEL} - Get new feed item and tweet`);

  const new_item = data.items.shift();
  const token = jwt.sign({
    twitter_consumer_key: process.env.FMD_TWITTER_CONSUMER_KEY,
    twitter_consumer_secret: process.env.FMD_TWITTER_CONSUMER_SECRET,
    twitter_access_token_key: process.env.FMD_TWITTER_ACCESS_TOKEN_KEY,
    twitter_access_token_secret: process.env.FMD_TWITTER_ACCESS_TOKEN_SECRET,
  }, process.env.FMD_TWEET_APP_SECRET);

  let payload = {};
  let response;

  Object.keys(new_item).forEach(key => {
    if (typeof new_item[key] !== 'undefined') {
      payload[key] = new_item[key];
    }
  });

  try {
    response = await fetch('https://fmd-tweets.netlify.com/.netlify/functions/tweet', {
      method: 'post',
      body: JSON.stringify(payload),
      headers: {
        'Authorization': token,
        'Content-Type': 'application/json'
      }
    });
  } catch(e) {
    console.log(`${PROCESS_LABEL} - [TWITTER][TWEET] Error: ${JSON.stringify(e)}`);
    throw e;
  }

  if ( response.status === 200 ) {
    console.log(`${PROCESS_LABEL} - [TWITTER][TWEET] Success`);
  } else {
    console.log(`${PROCESS_LABEL} - [TWITTER][TWEET] Error: ${response.statusText}`);
    throw new Error(`Failed to tweet: ${response.statusText}`);
  }

  try {
    let url = new URL(new_item.link)
    url.hostname = "findmydeals.tech"
    url.pathname = "/amazon" + url.pathname
  
    let caption = `
    ${new_item.title} 

    <a href="${url.toString()}"> https://amazon.in/dealoftheday </a>
    `

    let telegramURL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendPhoto?chat_id=${process.env.TELEGRAM_CHANNEL_ID}&photo=${new_item.image}&parse_mode=HTML&caption=${encodeURIComponent(caption)}`
    console.log(telegramURL)
    response = await fetch(telegramURL)
    console.log(await response.json())
  } catch (e) {
    console.log(`${PROCESS_LABEL} - [TELEGRAM][POST] Error: ${JSON.stringify(e)}`);
    // throw e;
  }


  if ( response.status === 200 ) {
    console.log(`${PROCESS_LABEL} - [TELEGRAM][POST] Success`);
  } else {
    console.log(`${PROCESS_LABEL} - [TELEGRAM][POST] Error: ${response.statusText}`);
    // throw new Error(`Failed to post to telegram: ${response.statusText}`);
  }


  try {
    await putObject(ACTIVE_PATH, JSON.stringify(data), {
      CacheControl: 'max-age=0'
    });
  } catch(e) {
    throw e;
  }

  return new_item;
}
