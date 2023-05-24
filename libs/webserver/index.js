'use strict';

const fs = require('fs');
const path = require('path');

const pathRoot = path.dirname(fs.realpathSync(__dirname)).split(path.sep).join(path.posix.sep);

const bodyParser = require('body-parser');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const express = require('express');
const session = require('express-session');
const MongoDBStore = require('connect-mongodb-session')(session);
const app = express();
const router = express.Router();
const Routes = require(pathRoot + '/webserver/routes.js');


const roomAuth = 'logs';

let shareData;
let socket;



const shouldCompress = (req, res) => {

	if (req.headers['x-no-compression']) {

		return false;
	}

	return compression.filter(req, res);
}



function initApp() {

	const sessionExpireMins = 60 * 24;
	const sessionSecret = shareData.appData.server_id;

	const store = new MongoDBStore({

		'uri': shareData.appData.mongo_db_url,
		'collection': 'sessions'
	},
	function(err) {

		if (err) {

			shareData.Common.logger(JSON.stringify(err));
		}
	});

	const sessionMiddleware = session({

		'secret': sessionSecret,
		'resave': false,
		'saveUninitialized': false,
		'store': store,
		'cookie': {
			'expires': (sessionExpireMins * 60) * 1000
		}
	});

	// Compress all HTTP responses
	app.use(compression({

		filter: shouldCompress,
		level: 6,

	}));

	app.disable('x-powered-by');

	app.use((req, res, next) => {

		res.append('Server', shareData.appData.name + ' v' + shareData.appData.version);

		next();
	});

	app.use(function(err, req, res, next) {

		shareData.Common.logger(JSON.stringify(err.stack));
	});

	app.set('views', pathRoot + '/webserver/public/views');
	app.set('view engine', 'ejs');

	app.use('/js', express.static(pathRoot + '/webserver/public/js'));
	app.use('/css', express.static(pathRoot + '/webserver/public/css'));
	app.use('/data', express.static(pathRoot + '/webserver/public/data'));
	app.use('/images', express.static(pathRoot + '/webserver/public/images'));

	app.use(sessionMiddleware);

	app.use(express.json());

	app.use(cookieParser());

	app.use(bodyParser.json({

		limit: "100mb",
		extended: true

	}));

	app.use(bodyParser.urlencoded({

		limit: "100mb",
		extended: true,
		parameterLimit: 500000

	}));

	app.use('/', router);

	return sessionMiddleware;
}


function initSocket(sessionMiddleware, server) {

	socket = require('socket.io')(server, {

		cors: {    
				origin: '*',
				methods: ['PUT', 'GET', 'POST', 'DELETE', 'OPTIONS'],
				credentials: false
		},
		path: '/ws',
		serveClient: false,
		pingInterval: 10000,
		pingTimeout: 5000,
		maxHttpBufferSize: 1e6,
		cookie: false
	});


	const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);

	socket.use(wrap(sessionMiddleware));

	socket.use((client, next) => {

		return next();
	});

	socket.on('connect', function (client) {

		let clientId = client.id;
		let loggedIn = client.request.session.loggedIn;
		let query = client.handshake.query;

		//console.log('Connected ID:', clientId, loggedIn);

		if (!loggedIn) {

			client.emit('error', 'Unauthorized');
			client.disconnect();			
		}
		else {

			if (query.room == undefined || query.room == null || query.room == '') {

				client.join(roomAuth);
			}
			else {

				client.join(query.room);
			}

			client.on('notifications_history', function (data) {

				shareData.Common.getNotificationHistory(client, data);
			});
		}
	});
}


async function sendSocketMsg(msg, room) {

	let sendRoom = roomAuth;

	if (room != undefined && room != null && room != '') {

		sendRoom = room;
	}

	if (socket) {

		socket.to(sendRoom).emit('data', msg);
	}
}


function start(port) {

	const sessionMiddleware = initApp();

	const server = app.listen(port, () => {

		shareData.Common.logger(`${shareData.appData.name} v${shareData.appData.version} listening on port ${port}`, true);

	}).on('error', function(err) {

		if (err.code === 'EADDRINUSE') {

			shareData.Common.logger(`Port ${port} already in use`, true);

			process.exit(1);
		}
	});

	initSocket(sessionMiddleware, server);

	Routes.start(router);
}


module.exports = {

	app,
	start,
	sendSocketMsg,

	init: function(obj) {

		shareData = obj;
		Routes.init(shareData);
    }
}

