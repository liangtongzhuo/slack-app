const config = require('./env');
const hosts = config.hosts;
const express = require('express');
const app = express();
const request = require('request');
const bodyParser = require('body-parser');
const moment = require('moment');
const crypto = require('crypto');

const helpers = require('./common/helpers');

// https://github.com/chyingp/nodejs-learning-guide/blob/master/%E8%BF%9B%E9%98%B6/debug-log.md
const debug = require('debug');
const appDebug = debug('app');

const messageGithubAndCodingNet = require('./SlackMessage/messageGithubAndCoding');
const messageBitbucketServer = require('./SlackMessage/messageBitbucketServer');

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Store our app's ID and Secret. These we got from Step 1.
// For this tutorial, we'll keep your API credentials right here. But for an actual app, you'll want to store them securely in environment variables.
const clientId = config.clientId;
const clientSecret = config.clientSecret;

const PORT = process.env.PORT || 3009;

const nowDate = function(timestamp = '') {
  if (timestamp) {
    return moment(timestamp).format('YYYY-MM-DD HH:mm:ss');
  }
  return moment().format('YYYY-MM-DD HH:mm:ss');
};

app.listen(PORT, function() {
  appDebug('Slack app listening on port ' + PORT);
});

// This route handles GET requests to our root ngrok address and responds with the same "Ngrok is working message" we used before
app.get('/', (req, res) => {
  res.send('it is working! Path Hit: ' + req.url);
});

// This route handles get request to a /oauth endpoint. We'll use this endpoint for handling the logic of the Slack oAuth process behind our app.
app.get('/oauth', (req, res) => {
  // When a user authorizes an app, a code query parameter is passed on the oAuth endpoint. If that code is not there, we respond with an error message
  if (!req.query.code) {
    res.status(500);
    res.send({ Error: "Looks like we're not getting code." });
    appDebug("Looks like we're not getting code.");
  } else {
    // If it's there...

    // We'll do a GET call to Slack's `oauth.access` endpoint, passing our app's client ID, client secret, and the code we just got as query parameters.
    request(
      {
        url: 'https://slack.com/api/oauth.access', // URL to hit
        // Query string data
        qs: {
          code: req.query.code,
          client_id: clientId,
          client_secret: clientSecret,
        },
        method: 'GET', // Specify the method
      },
      function(error, response, body) {
        if (error) {
          debug(error);
        } else {
          res.json(body);
        }
      }
    );
  }
});

// Route the endpoint that our slash command will point to and send back a simple response to indicate that ngrok is working
app.post('/command', (req, res) => {
  res.send('Your ngrok tunnel is up and running!');
});

// 连接mongo，查询吃啥表，返回一个记录
app.post('/fan', (req, res) => {
  const allDinner = require('./config/common').allDinner;
  const index = Math.floor(Math.random() * allDinner.length);
  res.send(allDinner[index]);
});

app.post('/fan-list', (req, res) => {
  const allDinner = require('./config/common').allDinner;
  res.send(allDinner.join(','));
});

app.post('/hexo', (req, res) => {
  const { stdout, stderr } = helpers.execShell('scripts/hexo.sh');
  if (stderr) {
    res.send('error');
  }
  res.send(`[${nowDate()}] success`);
});

const reqConfig = (req, res, attachments) => {
  const headers = {
    'Content-type': 'application/json',
  };
  const options = {
    url: config.channelUrl,
    method: 'POST',
    headers: headers,
    body: {
      attachments: attachments,
    },
    json: true,
  };

  request(options, (error, response, body) => {
    if (!error && response.statusCode == 200) {
      appDebug('push message to slack success');
    }
    res.send('');
  });
};

const findAgentName = userAgent => {
  let name = '';
  if (userAgent.split('-')[0]) {
    name = userAgent.split('-')[0];
    if (name === 'Bitbucket') {
      name = 'bitbucket-cloud';
      return name;
    }
  }
  if (name.indexOf('.') > 0 && name.indexOf('/') < 0) {
    name = name.split(' ')[0];
  }
  if (name.indexOf('/') > 0) {
    name = name.split('/')[1].trim();
    if (name === 'Bitbucket') {
      name = 'bitbucket-server';
    }
  }
  return name;
};

const findAgentByName = hostName => {
  return hosts.find(host => {
    return host.name === hostName.toLowerCase();
  });
};

// get secret middleware
const getAgentSecret = (req, res, next) => {
  req.sourceName = findAgentName(req.headers['user-agent']);
  req.secret = findAgentByName(req.sourceName).secret;
  next();
};

// hub signature verification middleware
const verifyHubSignature = (req, res, next) => {
  const signature = req.headers['x-hub-signature'] || req.headers['x-coding-signature'];
  if (signature !== undefined) {
    let expectedSignature = '';
    if (req.sourceName === 'bitbucket-server') {
      const hmac = crypto.createHmac('sha256', req.secret);
      hmac.update(JSON.stringify(req.body));
      expectedSignature = 'sha256=' + hmac.digest('hex');
    } else {
      const hmac = crypto.createHmac('sha1', req.secret);
      hmac.update(JSON.stringify(req.body));
      expectedSignature = 'sha1=' + hmac.digest('hex');
    }
    if (expectedSignature !== signature) {
      res.status(400).send('Invalid signature');
    } else {
      next();
    }
  } else {
    next();
  }
};

app.post('/', getAgentSecret, verifyHubSignature, (req, res) => {
  if (req.body.zen) {
    return res.send('success');
  }
  req.logo = findAgentByName(req.sourceName).logo;
  if (req.sourceName === 'bitbucket-server') {
    req.bitbucket_url = findAgentByName(req.sourceName).bitbucket_url;
    req.repo_url = findAgentByName(req.sourceName).repo_url;
    let messageBucketServer = new messageBitbucketServer(req);
    reqConfig(req, res, messageBucketServer.output());
  } else {
    let messageGithubAndCoding = new messageGithubAndCodingNet(req);
    reqConfig(req, res, messageGithubAndCoding.output());
  }
});
