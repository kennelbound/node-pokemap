'use strict';

var express = require('express');
var PokemonGo = require('pokemon-go-node-api');
var bodyParser = require('body-parser');
var app = express();
var crypto = require('crypto');
var jankStore = {}; // TODO will be replaced

//
// Shim for PokemonGo lib, needs pull request once complete
//
//
//var request = require('request');
//var FileCookieStore = require('tough-cookie-filestore');
//var path = require('path');
PokemonGo.Pokeio.prototype.serialize = function () {
  var self = this;
  var json = {
    username: self.playerInfo.username
  , password: self.playerInfo.password
  , provider: self.playerInfo.provider

  , latitude: self.playerInfo.latitude
  , longitude: self.playerInfo.longitude
  , altitude: self.playerInfo.altitude

    // refresh before expires
  , accessToken: self.playerInfo.accessToken
  , accessTokenExpires: self.playerInfo.accessTokenExpires
  , apiEndpoint: self.playerInfo.apiEndpoint
  };
  console.log('DEBUG json');
  console.log(json);
  return json;
};
PokemonGo.serialize = function (pokeio) {
  return pokeio.serialize();
};

PokemonGo.Pokeio.prototype.deserialize = function (opts) {
  var self = this;
  self.playerInfo.username = opts.username || 'johndoe';
  self.playerInfo.password = opts.password || 'secret';
  self.playerInfo.provider = opts.provider || 'ptc';
  self.playerInfo.accessToken = opts.accessToken || 'xyz';
  self.playerInfo.accessTokenExpires = opts.accessTokenExpires || 0;
  self.playerInfo.latitude = opts.latitude || 40.36915523640919;
  self.playerInfo.longitude = opts.longitude || -111.75098587678943;
  self.playerInfo.altitude = opts.altitude || 0;

  // TODO
  // logging reveals that cookies are probably not even used, just JWTs :)
  //self.j = request.jar(new FileCookieStore(path.resolve('/tmp/', self.playerInfo.username + '.pokemongo.json')));
  //self.request = request.defaults({ jar: self.j });

  self.playerInfo.apiEndpoint = opts.apiEndpoint;
};

PokemonGo.deserialize = function (opts) {
  var pokeio = new PokemonGo.Pokeio();
  pokeio.deserialize(opts);
  return pokeio;
};

PokemonGo.Pokeio.prototype.Login = function (username, password, provider, callback) {
  var self = this;

  if (provider !== 'ptc' && provider !== 'google') {
    return callback(new Error('Invalid provider'));
  }

  self.playerInfo.provider = provider;
  self.GetAccessToken(username, password, function (err, accessToken) {
    // Note: stores accessToken as self.playerInfo.accessToken
    if (err) {
      callback(err);
      return;
    }

    self.GetApiEndpoint(function (err, apiEndpoint) {
      // Note: stores endpoint as self.playerInfo.apiEndpoint
      if (err) {
        callback(err);
        return;
      }

      if (callback) {
        callback(null, {
          username: username
        //, password: password // TODO cipher
        , provider: provider
        , accessToken: accessToken
        , apiEndpoint: apiEndpoint
        });
      }
    });
  });
};

function postLogin(req, res) {
  var pokeio = new PokemonGo.Pokeio();

  // location = { latitude, longitude, altitude, type(coords|name), name }
  // provider = ptc | google
  //pokeio.init(req.body.username, req.body.password, req.body.location, req.body.provider, function (err) {
  pokeio.Login(
    req.body.username
  , req.body.password
  , req.body.provider
  , function (err/*, { username, password, provider, accessToken, apiEndpoint }*/) {
    // Note: stores accessToken as self.playerInfo.accessToken
    if (err) {
      res.send({ error: { message: err.toString() } });
      return;
    }

    // TODO use JWT and database
    var rnd = crypto.randomBytes(16).toString('hex');
    var expIn = (15 * 60);
    var expAt = new Date(Date.now() + (expIn * 1000)).valueOf();

    // TODO send password back to client, encrypted
    jankStore[rnd] = {
      exp: expAt
    , accessToken: rnd
    , username: req.body.username
    , password: req.body.password // TODO store in JWT, encrypted
    , provider: req.body.provider
    , session: PokemonGo.serialize(pokeio)
    };
    // TODO XXX REMOVE THIS!!!
    jankStore.test = jankStore[rnd];

    res.send({ access_token: jankStore[rnd].accessToken, expires_in: expIn });
  });
}

function getData(req, res) {
  // TODO handle updates
  // query = { location, pokestops, gyms, pokemons }

  function getNearby() {
    pokeio.Heartbeat(function (err, hb) {
      var pokemons = [];

      if (err) {
        console.error('ERROR: Heartbeat');
        console.error(err);
        res.send({ error: { message: err.toString() } });
        return;
      }

      console.log('DEBUG hb');
      console.log(hb);

      hb.cells.forEach(function (cell) {
        cell.MapPokemon.forEach(function (pokemon) {

          var exp = pokemon.ExpirationTimeMs; //.toUnsigned(); // TODO convert to int more exactly
          var id = Buffer.alloc(8); // pokemon.EncounterId;        // ??? how to convert from ProtoLong to base64? // also NearbyPokemon[i].EncounterId
          var l = pokemon.EncounterId;

          console.log('DEBUG pokemon.EncounterId');
          console.log(pokemon.EncounterId.high);
          console.log(pokemon.EncounterId.low);
          if (id.unsigned) {
            id.writeUInt32LE(pokemon.EncounterId.high, 0);
            id.writeUInt32LE(pokemon.EncounterId.low, 4);
            //id.writeUInt32LE(pokemon.EncounterId.low);
            //id.writeUInt32LE(pokemon.EncounterId.high);
          }
          else {
            // https://github.com/dcodeIO/long.js/issues/34#issuecomment-234544371
            // BE
            id.writeInt32BE(l.high, 0);
            id.writeInt32BE(l.low, 4);
            // or LE
            //id.writeInt32LE(l.low, 0);
            //id.writeInt32LE(l.high, 4);
          }

          pokemons.push({
            disappear_time: exp.toNumber()
          //, encounter_id: null
          , encounter_id: id.toString('base64') // this is probably still wrong
          , latitude: parseFloat(pokemon.Latitude.toString(), 10)
          , longitude: parseFloat(pokemon.Longitude.toString(), 10)
          , pokemon_id: pokemon.PokedexTypeId // also NearbyPokemon[i].PokedexNumber
          , pokemon_name: (pokeio.pokemonlist[pokemon.PokedexTypeId - 1]||{}).name
          , spawnpoint_id: pokemon.SpawnpointId
          });
        });
      });

      res.send({
        pokemons: pokemons
      , pokestops: []
      , gyms: []
      });
    });
  }

  // TODO check expAt
  var creds = req.sess;
  if (!req.query.latitude || !req.query.longitude) {
    res.send({ error: { message: "missing latitude or longitude" } });
    return;
  }

  // TODO allow named coords
  // var geocoder = require('geocoder');
  // geocoder.reverseGeocode(lat, lng, function (err, data) { ... });
  // geocoder.geocode(locationName, function (err, data) { ... });

  creds.session.latitude = parseFloat(req.query.latitude || req.query.lat, 10) || creds.session.latitude;
  creds.session.longitude = parseFloat(req.query.longitude || req.query.lng || req.query.lon, 10) || creds.session.longitude;
  creds.session.altitude = parseFloat(req.query.altitude || req.query.alt, 10) || 0;

  ///*
  var pokeio = PokemonGo.deserialize(creds.session);

  getNearby();
  //*/

  //
  /*
  var pokeio = new PokemonGo.Pokeio();
  var loc = { type: 'coords', coords: { latitude: creds.session.latitude, longitude: creds.session.longitude } };

  // TODO we don't really want to re-init, but the deserialize isn't working yet
  pokeio.init(creds.username, creds.password, loc, creds.session.provider, function (err) {
    if (err) {
      console.error('ERROR: init');
      console.error(err);
      res.send({ error: { message: err.toString() } });
      return;
    }

    pokeio.GetProfile(function(err, profile) {
      console.log('DEBUG profile');
      console.log(profile);

      getNearby();
    });
  });
  //*/
}

function getLoc(req, res) {
  res.send({
    latitude: req.sess.session.latitude
  , longitude: req.sess.session.longitude
  });
}

function postLoc(req, res) {
  req.sess.session.latitude = parseFloat(req.query.lat, 10);
  req.sess.session.longitude = parseFloat(req.query.lng, 10);

  res.send({ success: true });
}

function attachSession(req, res, next) {
  var accessToken = (req.headers.authorization||'').replace(/(Bearer|Token|JWT) /ig, '');

  req.sess = jankStore[accessToken];
  next();
}

function requireSession(req, res, next) {
  if (!req.sess) {
    res.send({ error: { message: "unrecognized access token, try again" } });
    return;
  }

  next();
}

app.use('/api/com.pokemon.go/login', bodyParser.json());
app.post('/api/com.pokemon.go/login', postLogin);

app.use('/', attachSession);

app.get('/api/com.pokemon.go/nearby', requireSession, getData);
app.get('/raw_data', requireSession, getData);

// Get / Set session data (pretty useless, on the whole)
app.get('/loc', requireSession, getLoc);
app.post('/next_loc', requireSession, postLoc);
//app.post('/pokemon', getData);

module.exports = app;
