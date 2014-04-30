/*
 * imdone
 * https://github.com/piascikj/imdone
 *
 * Copyright (c) 2012 Jesse Piascik
 * Licensed under the MIT license.
 */
  // ARCHIVE:40 Upgrade express - [ExpressJS 4.0: New Features and Upgrading from 3.0 ♥ Scotch](http://scotch.io/bar-talk/expressjs-4-0-new-features-and-upgrading-from-3-0)
  var express      = require('express');
  var bodyParser   = require('body-parser');
  var cookieParser = require('cookie-parser');
  var http         = require('http');
  var fs           = require('fs');
  var _            = require('lodash');
  var Handlebars   = require('handlebars');
  var util         = require('util');
  var io           = require('socket.io');
  var mkdirp       = require('mkdirp');
  var path         = require('path');
  var Search       = require('imdone-core').Search;
  var tree         = require('./util/tree');
  var server       = module.exports;
  var log        = require('debug')('imdone:server');
  var EVENTS       = {
                       PROJECT_MODIFIED: "project.modified",
                       PROJECT_INITIALIZED: "project.initialized",
                       PROJECT_REMOVED: "project.removed",
                       FILES_PROCESSED: "files.processed"
                     };

  function isBusy(req,res) {
    var projectName = req.body.project || req.query.project || req.params[0];
    var project = server.imdone.getProject(projectName);
    return (project) ? project.isBusy() : undefined;
  }

  function getProjects(req, res) {
      res.send(server.imdone.getProjects());
  }

  // ARCHIVE:100 use imdone-core
  function getKanban(req, res){
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }
    // log("Getting project with name:", req.params[0]);

    var project = server.imdone.getProject(req.params[0]);

    if (project) {
      res.send({
        lists:project.getTasks(null, true),
        readme:project.getRepos()[0].getDefaultFile()
      });
    } else {
      res.send(404);
    }
  }

  // ARCHIVE:110 use imdone-core
  function moveTasks(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }
    var project = server.imdone.getProject(req.body.project);
    var tasks = req.body.tasks;
    var newList = req.body.newList;
    var newPos = req.body.newPos;
    project.moveTasks(tasks, newList, newPos, function() {
      res.send(200);
    });
  }

  // ARCHIVE:120 use imdone-core
  function moveList(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }
    var pos = parseInt(req.body.pos, 0);
    var project = server.imdone.getProject(req.body.project);
    project.moveList(req.body.name, pos, function(err) {
      if (err) {
        console.log(err);
        res.send(500);
      } else res.send(200);
    });
  }

  // ARCHIVE:130 use imdone-core
  function removeList(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }

    server.imdone.getProject(req.body.project).removeList(req.body.list, function(err) {
      if (err) res.send(500);
      else res.send(200);
    });

  }

  // ARCHIVE:140 use imdone-core
  function renameList(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }
    var project = server.imdone.getProject(req.body.project);
    var name = req.body.name;
    var newName = req.body.newName;
    project.renameList(name, newName, function(err) {
      if (err) return res.send(500);
      res.send(200);
    });
  }

  // ARCHIVE:150 use imdone-core
  function hideList(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }
    server.imdone.getProject(req.body.project).hideList(req.body.list, function(err) {
      if (err) res.send(500);
      else res.send(200);
    });
  }

  // ARCHIVE:160 use imdone-core
  function showList(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }

    server.imdone.getProject(req.body.project).showList(req.body.list, function(err) {
      if (err) res.send(500);
      else res.send(200);
    });
  }

  // ARCHIVE:830 Have this use splat for project name like getFiles
  // ARCHIVE:530 Move getSource to imdone.js
  // ARCHIVE:170 use imdone-core
  function getSource(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }

    var path = req.query.path;
    var line = req.query.line;
    var project = server.imdone.getProject(req.params[0]);
    var repoId = project.getRepos()[0].getId();
    var file = project.getFileWithContent(repoId, path);
    if (file) {
      return res.send({
          repoId: file.getRepoId(),
          src:file.getContent(), 
          line:line,
          lang:file.getLang().name,
          ext:file.getExt(),
          project:project.path,
          path:file.getPath()
      });
    } else {
      project.saveFile(repoId, path, "", function(err, file) {
        if (err) return res.send(500, err);
        res.send({
          repoId: file.getRepoId(),
          src:"", 
          line:line,
          lang:file.getLang().name,
          ext:file.getExt(),
          project:project.path,
          path:file.getPath()
        });
      });
    }
  }

  // ARCHIVE:850 Have this use splat for project name like getFiles
  // ARCHIVE:180 use imdone-core
  function saveSource(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }

    var path = req.body.path,
        src = req.body.src,
        repoId = req.body.repoId,
        project = server.imdone.getProject(req.params[0]);

    project.saveFile(repoId, path, src, function(err, file) {
      res.send(file);
    });
  }

  // ARCHIVE:780 Move removeSource to imdone.js and add hook    
  // ARCHIVE:60 use imdone-core for removeSource
  function removeSource(req, res) {
    if (isBusy(req,res)) {
      res.send({busy:true});
      return;
    }

    var path = req.query.path,
        project = server.imdone.getProject(req.params[0]);

    if (project) {
       var repoId = project.getRepos()[0].getId();
       project.deleteFile(repoId, path, function(err, file) {
        res.send(200, {file:file, deleted:true});
       });
    } else {
      res.send(409,"Unable to remove source");
      return;
    }
  }

  // ARCHIVE:190 use imdone-core
  function getFiles(req,res) {
    var project = server.imdone.getProject(req.params[0]);
    if (project) {
      var files = project.getFileTree(project.getRepos()[0].getId());
      if (files) {
        res.send(files);
      } else {
        res.send(404, "Project not found");
      }
    } else {
      var files = tree.getFiles(req.params[0]);
      if (files) {
        res.send(files);
      } else {
        res.send(404, "Directory not found");
      }
    }
  }

  // PLANNING:130 Use imdone-core for md, local and remote
  function md(req,res) {
    var project = server.imdone.getProject(req.params[0]);
    var path = req.query.path;
    if (project.path) {
      project.md(path, function(html) {
        res.send(html);
      });
    } else {
      res.send(404, "Unable to get html for file");
    }
  }

  // ARCHIVE:200 use imdone-core for search
  function doSearch(req,res) {
    var opts = {project:server.imdone.getProject(req.params[0])};
    var query = req.query.query;
    var limit = req.query.limit;
    var offset = req.query.offset;
    if (query) opts.query = query;
    if (limit) opts.limit = limit;
    if (offset) opts.offset = offset;
    var s = new Search(opts);
    s.execute();
    res.send(s);
  }

  function addProject(req, res) {
    var dir = req.params[0];
    res.send(server.imdone.addProject(dir));
  }

  function removeProject(req, res) {
    var name = req.params[0];
    server.imdone.removeProject(name);
    res.send(200);
  }

  function addList(req, res) {
    var project = server.imdone.getProject(req.params.project);
    var list = req.params.list;
    project.addList(list, function(err) {
      if (err) return res.send(500);
      return res.send(200);
    });
  }

  server.start = function(imdone, callback) {
    server.imdone = imdone;

    //ARCHIVE:720 migrate to express 3.x <https://github.com/visionmedia/express/wiki/Migrating-from-2.x-to-3.x>
    var app = server.app = express();
    var  xserver = http.createServer(app);

    app.use(cookieParser());
    app.use(bodyParser());

    //Start the api and static content server
    /*
      /api/tasks
      /api/lists
      /api/projects
      /api/source
      /api/files
    */
    // ARCHIVE:870 Make sure we're restful
    app.post("/api/moveTasks", moveTasks);
    app.post("/api/moveList", moveList);
    app.post("/api/removeList", removeList);
    app.post("/api/renameList", renameList);
    app.post("/api/hideList", hideList);
    app.post("/api/showList", showList);
    app.get("/api/kanban/*", getKanban);
    app.post("/api/project/*", addProject);
    app.delete("/api/project/*", removeProject);
    app.get("/api/projects", getProjects);
    app.get("/api/source/*", getSource);
    app.put("/api/source/*", saveSource);
    app.del("/api/source/*", removeSource);
    app.get("/api/files/*", getFiles);
    app.get("/api/search/*", doSearch);
    app.get("/api/md/*", md);
    app.post("/api/list/:project/:list", addList);

    app.get("/js/marked.js", function(req,res) {
      log(require.resolve("marked"));
      res.sendfile(require.resolve("marked").toString());
    });

    //Serve static files
    app.use(express.static(__dirname + '/../public'));


    //Start the websocket server
    io = io.listen(xserver);

    io.enable('browser client minification');  // send minified client
    io.enable('browser client etag');          // apply etag caching logic based on version number
    io.enable('browser client gzip');          // gzip the file
    io.set('log level', 1);                    // reduce logging

    io.sockets.on('connection', function(socket) {
      log("connected to:", socket);
      var onProjectModified = function(data) {
        log("emitting:", EVENTS.PROJECT_MODIFIED);
        socket.emit(EVENTS.PROJECT_MODIFIED, data);
      };

      var onProjectInitialized = function(data) {
        log("emitting:", EVENTS.PROJECT_INITIALIZED);
        socket.emit(EVENTS.PROJECT_INITIALIZED, data);
      };

      var onProjectRemoved = function(data) {
        log("emitting:", EVENTS.PROJECT_REMOVED);
        socket.emit(EVENTS.PROJECT_REMOVED, data);
      };

      var onFilesProcessed = function(data) {
        log("emitting:", EVENTS.FILES_PROCESSED);
        socket.emit(EVENTS.FILES_PROCESSED, data);
      };

      server.imdone.emitter.on(EVENTS.PROJECT_INITIALIZED, onProjectInitialized);
      server.imdone.emitter.on(EVENTS.PROJECT_REMOVED, onProjectRemoved);
      server.imdone.emitter.on(EVENTS.PROJECT_MODIFIED, onProjectModified);
      server.imdone.emitter.on(EVENTS.FILES_PROCESSED, onFilesProcessed);

      // ARCHIVE:210 Remove listeners on disconnect
      socket.on('disconnect', function () {
        log('disconnected');
        server.imdone.emitter.removeListener(EVENTS.PROJECT_INITIALIZED, onProjectInitialized);
        server.imdone.emitter.removeListener(EVENTS.PROJECT_REMOVED, onProjectRemoved);
        server.imdone.emitter.removeListener(EVENTS.PROJECT_MODIFIED, onProjectModified);
        server.imdone.emitter.removeListener(EVENTS.FILES_PROCESSED, onFilesProcessed);
      });
    });    

    if (callback) app.on('listening', callback);
    xserver.listen(imdone.config.port);

    //ARCHIVE:320 Move open board to command line option **open**
  };
  