let createError = require('http-errors'),
    express = require('express'),
    child_process = require('child_process'),
    path = require('path'),
    cookieParser = require('cookie-parser'),
    logger = require('morgan'),
    debug = require('debug')('server-media-server:server'),
    http = require('http'),
    indexRouter = require('./routes/index'),
    usersRouter = require('./routes/users'),
    port = normalizePort(process.env.PORT || '4000'),
    app = express(),
    cors = require('cors'),
    server = http.createServer(app),
    WebSocketServer = require('ws').Server,
    ffbinaries = require('ffbinaries'),
    wss = new WebSocketServer({ server: server }),
    NodeMediaServer = require('node-media-server');

app.set('port', port);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(cors());
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'browser')));
app.use('/', indexRouter);
app.use('/media-server', express.static(path.join(__dirname, 'browser')));
app.use('/users', usersRouter);
app.use(function(req, res, next) {
  next(createError(404));
});
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

ffbinaries.downloadBinaries(['ffmpeg', 'ffprobe'], { quiet: true, destination: __dirname + '/binaries'}, function () {
    console.log('Downloaded ffplay and ffprobe binaries to ' + __dirname + '/binaries' + '.');
});
startMediaServer();

wss.on('connection', (ws, req) => {
  // Ensure that the URL starts with '/rtmp/', and extract the target RTMP URL.
/*    let match;
    if ( !(match = req.url.match(/^\/rtmp\/(.*)$/)) ) {
      ws.terminate(); // No match, reject the connection.
      return;
    }
    const rtmpUrl = decodeURIComponent(match[1]);
    console.log('Target RTMP URL:', rtmpUrl);*/
    // Launch FFmpeg to handle all appropriate transcoding, muxing, and RTMP.
    // If 'ffmpeg' isn't in your path, specify the full path to the ffmpeg binary.
    const ffmpeg = child_process.spawn('./binaries/ffmpeg', [
        // Facebook requires an audio track, so we create a silent one here.
        // Remove this line, as well as `-shortest`, if you send audio from the browser.
        '-f', 'lavfi', '-i', 'anullsrc',

        // FFmpeg will read input video from STDIN
        '-i', '-',

        // Because we're using a generated audio source which never ends,
        // specify that we'll stop at end of other input.  Remove this line if you
        // send audio from the browser.
        '-shortest',

        // If we're encoding H.264 in-browser, we can set the video codec to 'copy'
        // so that we don't waste any CPU and quality with unnecessary transcoding.
        // If the browser doesn't support H.264, set the video codec to 'libx264'
        // or similar to transcode it to H.264 here on the server.
        '-vcodec', 'copy',

        // AAC audio is required for Facebook Live.  No browser currently supports
        // encoding AAC, so we must transcode the audio to AAC here on the server.
        '-acodec', 'aac',

        // FLV is the container format used in conjunction with RTMP
        '-f', 'flv',

        // The output RTMP URL.
        // For debugging, you could set this to a filename like 'test.flv', and play
        // the resulting file with VLC.  Please also read the security considerations
        // later on in this tutorial.
        'rtmp://localhost:1935/live/stream'
    ]);

    // If FFmpeg stops for any reason, close the WebSocket connection.
    ffmpeg.on('close', (code, signal) => {
        console.log('FFmpeg child process closed, code ' + code + ', signal ' + signal);
        ws.terminate();
    });

    // Handle STDIN pipe errors by logging to the console.
    // These errors most commonly occur when FFmpeg closes and there is still
    // data to write.  If left unhandled, the server will crash.
    ffmpeg.stdin.on('error', (e) => {
        console.log('FFmpeg STDIN Error', e);
    });

    // FFmpeg outputs all of its messages to STDERR.  Let's log them to the console.
    ffmpeg.stderr.on('data', (data) => {
        console.log('FFmpeg Data Transfer:', data.toString());
    });

    // When data comes in from the WebSocket, write it to FFmpeg's STDIN.
    ws.on('message', (msg) => {
        console.log('Ws DATA', msg);
        ffmpeg.stdin.write(msg);
    });

    // If the client disconnects, stop FFmpeg.
    ws.on('close', (e) => {
        ffmpeg.kill('SIGINT');
    });


});
server.listen(port);
server.on('error', onError);
server.on('listening', onListening);
//Запуск медиа сервиса
function normalizePort(val) {
  var port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}
function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  var bind = typeof port === 'string'
      ? 'Pipe ' + port
      : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */
function onListening() {
  var addr = server.address();
  var bind = typeof addr === 'string'
      ? 'pipe ' + addr
      : 'port ' + addr.port;
  debug('Listening on ' + bind);
}

function startMediaServer(){
  const config = {
      rtmp: {
          port: 1935,
          chunk_size: 60000,
          gop_cache: true,
          ping: 30,
          ping_timeout: 60
      },
      http: {
          port: 7000,
          mediaroot: './media/',
          allow_origin: '*'
      },
      relay: {
          ffmpeg: './binaries/ffmpeg.exe',
          tasks: [
              {
                  app: 'live',
                  mode: 'static',
                  edge: 'rtsp://:554/rtsp',//rtsp
                  name: 'technology',
                  rtsp_transport : 'tcp', //['udp', 'tcp', 'udp_multicast', 'http']
              }
          ]
      },
      trans: {
          ffmpeg: './binaries/ffmpeg.exe',
          tasks: [
              {
                  app: 'live',
                  hls: true,
                  hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
                  dash: true,
                  dashFlags: '[f=dash:window_size=3:extra_window_size=5]'
              }
          ]
      }
  };

   let nms = new NodeMediaServer(config)
   nms.run();
  //подписки на события
  nms.on('preConnect', (id, args) => {
    console.log('[NodeEvent on preConnect]', `id=${id} args=${JSON.stringify(args)}`);
    // let session = nms.getSession(id);
    // session.reject();
  });

  nms.on('postConnect', (id, args) => {
    console.log('[NodeEvent on postConnect]', `id=${id} args=${JSON.stringify(args)}`);
  });

  nms.on('doneConnect', (id, args) => {
    console.log('[NodeEvent on doneConnect]', `id=${id} args=${JSON.stringify(args)}`);
  });

  nms.on('prePublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
    // let session = nms.getSession(id);
    // session.reject();
  });

  nms.on('postPublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on postPublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  });

  nms.on('donePublish', (id, StreamPath, args) => {
    console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  });

  nms.on('prePlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on prePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
    // let session = nms.getSession(id);
    // session.reject();
  });

  nms.on('postPlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on postPlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  });

  nms.on('donePlay', (id, StreamPath, args) => {
    console.log('[NodeEvent on donePlay]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
  });
 }
