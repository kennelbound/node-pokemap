'use strict';

var http = require('http');
var express = require('express');
var app = express();
var pokeapp = require('./');
var plainServer = http.createServer(app);
var port = process.env.PORT || 5000;
// var tlsServer = https.createServer(certs, app);

app.use('/', pokeapp);
app.use('/static', express.static('./public/static'));
app.use('/', express.static('./public/static'));

plainServer.listen(port, function () {
    console.log('Pokemon on ' + plainServer.address().port);
});