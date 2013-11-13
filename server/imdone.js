/*
 * imdone
 * https://github.com/piascikj/imdone
 *
 * Copyright (c) 2012 Jesse Piascik
 * Licensed under the MIT license.
 */
//[Implement hide functionality to hide a list from board](#archive:250)
// Nodejs libs.
var fs = require('fs');
var program = require("commander");
var wrench = require('wrench');
var _ = require('underscore');
var watchr = require('watchr');
var marked = require('marked');
var open = require('open');
var request = require('request');
var express = require('express');
var http = require('http');
var server = require("./server");
var tasks = require("./tasks");
var languages = require("./util/languages");

var imdone = module.exports = {pause:{}};
var pkginfo = require('pkginfo')(module);

imdone.config = {
  port: process.env.IMDONE_PORT || 8080,
  cliPort: process.env.IMDONE_CLI_PORT || 8899
};

imdone.projects = {};

imdone.server = server;

/*
  `imdone` will add the current working directory to imdone projects and start imdone if not already up
  `imdone stop` will stop imdone
*/
imdone.start = function(dir) {
  program
  .usage("[options]")
  .version(imdone.version)
  .option('-o, --open', 'Open imdone in the default browser')
  .option('-s, --stop', 'Stop imdone server')
  .option('-d, --dirs <directories>', 'A comma separated list of project directories', function list(val) {
    return val.split(',');
  });

  program.on('--help', function(){
    console.log('  Examples:');
    console.log('');
    console.log('    Open imdone in a browser with the current working directory as the project root');
    console.log('');
    console.log('    $ imdone -o');
    console.log('');
    console.log('    Open imdone in a browser with list of project directories');
    console.log('');
    console.log('    $ imdone -o -d projects/imdone,projects/myproject');
  });

  console.log("  _   __  __   _____                         ");
  console.log(" (_) |  \\/  | |  __ \\                        ");
  console.log("  _  | \\  / | | |  | |   ___    _ __     ___ ");
  console.log(" | | | |\\/| | | |  | |  / _ \\  | '_ \\   / _ \\");
  console.log(" | | | |  | | | |__| | | (_) | | | | | |  __/");
  console.log(" |_| |_|  |_| |_____/   \\___/  |_| |_|  \\___|");

  program.parse(process.argv);

  var dirs = program.dirs || [dir];

  if (program.stop) {
    imdone.cliStop();
  } else {

    if (program.open) open('http://localhost:' + imdone.config.port);

    imdone.checkCLIService(function() {
      console.log("iMDone service is already running!");
      _.each(dirs, function(d) {
        imdone.cliAddProject(d);
      });
    }, function() {
      imdone.startCLIService(function() {
        _.each(dirs, function(d) {
          imdone.addProject(d);
        });
      });
    });
  }
};

imdone.startCLIService = function(callback) {
  //Start a service on 8899 for cli to interact with
  //Access imdone data through getters and setters that require project path
  var app = imdone.cliService = express();
  var xserver = http.createServer(app);
  app.use(express.cookieParser());
  app.use(express.bodyParser());

  //Start the api and static content server
  app.get("/cli", function(req, res) {
    res.send({ok:imdone.up});
  });
  app.post("/cli/project", function(req, res) {
    res.send(imdone.addProject(req.body.cwd));
  });
  app.post("/cli/stop", function(req, res) {
    res.send({ok:true});
    process.exit();
  });
  
  xserver.on('listening', function() {
    imdone.up = true;
    if (callback) callback();
  });
  xserver.listen(imdone.config.cliPort);

  server.start(imdone);
};

imdone.cliAddProject = function(dir) {
  request.post({
    url:"http://localhost:" + imdone.config.cliPort + "/cli/project",
    json:{cwd:dir}
  }, function(error, res, body) {
    if (!res) {
      console.log("failed to add project");
    } else {
      console.log(body);
    }
  });

};

imdone.cliStop = function() {
  request.post({
    url:"http://localhost:" + imdone.config.cliPort + "/cli/stop"
  }, function(error, res, body) {
    if (!res) {
      console.log("failed to stop imdone service");
    } else {
      console.log("imdone service has been stopped");
    }
  });

};


imdone.checkCLIService = function(success, failure) {
  request.get({
    url:"http://localhost:" + imdone.config.cliPort + "/cli",
  }, function(error, res, body) {
    if (!res) {
      failure();
    } else {
      success();
    }
  });
};

imdone.addProject = function(dir) {
  if (!/^\//.test(dir)) dir = process.cwd() + "/" + dir;

  console.log("Adding project at:" + dir);

  if (!imdone.projects[dir]) {
    imdone.projects[dir] = new imdone.Project(dir);
    imdone.projects[dir].init();
  } 

  return imdone.projects[dir];
};

imdone.getProject = function(dir) {
  return imdone.projects[dir] || {};
};

imdone.getProjects = function() {
  return _.keys(imdone.projects);
};

imdone.getLastUpdate = function() {
  return _.map(imdone.projects, function(project, key){ return {project:project.path, lastUpdate:project.lastUpdate}; });
};

/*

  This is the Project class

*/

imdone.Project = function(path) {
  this.cwd = this.path = path;
  this.tasks = {};
  this.config = {};
};

imdone.Project.prototype.init = function() {
  var self = this;
  console.log("Initializing project:" + this.path);
  this.initConfig(function() {

    self.config.cwd = self.cwd;

    self.loadListData(function() {

      self.processFiles(wrench.readdirSyncRecursive(self.path), function() {
        //set up watcher
        self.watchFiles(self.path);
      });
    });
  });
};

imdone.Project.prototype.shouldProcessFile = function(file) {
  var relPath = this.relativePath(file);
  return !this.config.exclude.test(relPath);
};

imdone.Project.prototype.shouldProcessDir = function(file) {
  var relPath = this.relativePath(file) + "/";
  return !this.config.exclude.test(relPath);
};


imdone.Project.prototype.getFiles = function(path) {
  var self = this,
      out = {},
      sub = false;

  if (path) {
    sub = true;
  } else {
    path = this.path;
  }
  
  var files =  fs.readdirSync(path);

  if (sub) {
    _.each(files, function(val,i) {
      files[i] = path + "/" + val;
    });
  }

  files = self.filesToProcess(files,true).sort();
  if (!sub) out.path="/";
  _.each(files, function(file) {
    var name = file.split("/").pop();
    var relPath = self.relativePath(file);
    if (fs.statSync(file).isDirectory() && self.shouldProcessDir(file)) {
        if(!out.dirs) out.dirs = [];
        out.dirs.push(_.extend({name:name,path:relPath},self.getFiles(file)));
    } else if (fs.statSync(file).isFile() && self.shouldProcessFile(file)) {
      if(!out.files) out.files = [];

      out.files.push({name:name,path:relPath,project:self.path});
    }
  });
  return out;
};

imdone.Project.prototype.getURL = function(file, line) {
  return "/api/source" + this.path + "?path=" + file + "&line=" + line;
};

imdone.Project.prototype.location = function() {
  return "local";
};

imdone.Project.prototype.getReadme = function() {
  var files = fs.readdirSync(this.path);
  var readme;
  _.each(files, function(file) {
    if (/README\.(MD|MARKDOWN)/.test(file.toUpperCase())) readme = file; 
  });
  return readme;
};

imdone.Project.prototype.getSortedLists = function() {
  var lists = {}, out = [], self = this;
  _.each(this.lists, function(list) {
    lists[list] = [];
  });
  _.each(this.tasks, function(fileTasks, file){
    _.each(fileTasks.tasks,function(task, id) {
      var list = task.list;
      lists[list].push(task);
    });
  });

  _.each(lists, function(tasks, list) {
    var listObj = {name:list};
    if (_.contains(self.hidden, list)) {
      listObj.hidden = true;
    } else {
      listObj.tasks = _.sortBy(tasks, "order");
    }
    out.push(listObj);
  });

  out = _.sortBy(out, function(listObj) {
    return _.indexOf(self.lists,listObj.name);
  });

  return out;  
};

imdone.Project.prototype.renameList = function(request) {
  var self = this;
  var name = request.name;
  var newName = request.newName;
  var pos = _.indexOf(this.lists, name);
  var list = _.where(this.getSortedLists(),{name:name})[0];
  //console.log(JSON.stringify(list, null, 3));
  
  var files = {};
  _.each(list.tasks, function(task) {
    var fullPath = self.fullPath(task.path);
    if (!files[task.path]) {
      self.pause(task.path);
      files[task.path] = fs.readFileSync(fullPath, "utf8");
    }
    task.list = newName;
    files[task.path] = self.modifyTask(files[task.path], task);
  });

  //unpause all paths in the list and write files
  _.each(files, function(data, path) {
    fs.writeFileSync( self.fullPath(path), data, "utf8");
    if (self.isPaused(path)) self.unpause(path);
  });

  var lists = _.without(this.lists, name, newName);
  lists.splice(pos,0,newName);
  this.lists = lists;
  this.saveListData();

  // [Document afterRenameList in config and README.md](#doing:0)
  // if (_.isFunction(self.config.afterRenameList)) {
  //   process.nextTick(function(){
  //     self.config.afterRenameList(_.keys(files));
  //   });
  // }

  return imdone.lists;
};

imdone.Project.prototype.removeList = function(request) {
  var list = request.list;
  console.log("removing list:" + list);
  this.lists = _.without(this.lists, list);
  this.saveListData();
  return this.lists;
};

imdone.Project.prototype.moveList = function(request) {
  var list = request.list;
  var pos = parseInt(request.position, null);
  var lists = _.without(this.lists, list);
  lists.splice(pos, 0, list);
  this.lists = lists;
  this.saveListData();
  return this.lists;
};

imdone.Project.prototype.hideList = function(request) {
  var list = request.list;
  console.log("Hiding list:" + list);
  this.hidden.push(list);
  this.hidden = _.uniq(this.hidden);
  this.lastUpdate = new Date();
  this.saveListData();
  return this.hidden;
};

imdone.Project.prototype.showList = function(request) {
  var list = request.list;
  this.hidden = _.without(this.hidden, list);
  this.lastUpdate = new Date();
  this.saveListData();
  return this.hidden;
};

//[When moving task to top of list, it goes to second place.  Need to fix this](#archive:210)
imdone.Project.prototype.moveTask = function(request, callback) {
  var self = this;
  var path = request.path;
  var from = request.from;
  var to = request.to;
  var lastUpdate = request.lastUpdate;
  var pos = parseInt(request.pos, null);
  var pathTaskId = parseInt(request.pathTaskId, null);

  //Get the current task from the data
  var pathObj = this.tasks[path],
    task = pathObj.tasks[pathTaskId];

  task.list = to;
  //console.log("------------------Moving Task---------------------");
  //console.log(JSON.stringify(task, null, 3));

  //if the lastUpdate is different return need refresh
  if (new Date(lastUpdate) < pathObj.lastUpdate) {
    return {refresh:true};
  }

  var lists = self.getSortedLists();
  var toList = _.findWhere(lists, {name:to});

  //move the task to the correct position in the list
  toList.tasks = _.reject(toList.tasks, function(task) {
    return task.pathTaskId === pathTaskId && task.path === path;
  });
  toList.tasks.splice(pos,0,task);
  //console.log(JSON.stringify(toList, null,3));

  var files = {};
  //Modify the tasks and files in current list
  _.each(toList.tasks, function(task, index) {
    var fullPath = self.fullPath(task.path);
    //Read the file if we don't have it yet
    if (!files[task.path]) {
      self.pause(task.path);
      files[task.path] = fs.readFileSync(fullPath, "utf8");
    }
    
    task.order = index*10;
    //console.log("modifying task:" + JSON.stringify(task, null,3));
    files[task.path] = self.modifyTask(files[task.path], task);
  });  

  //If task was moved to a new list, modify the old
  //console.log("\nModify the old list\n");
  if (to !== from) {
    var fromList = _.findWhere(lists, {name:from});
    _.reject(fromList.tasks, function(task) {
      return task.pathTaskId === pathTaskId && task.path === path;
    });
    _.each(fromList.tasks, function(task, index) {
      var fullPath = self.fullPath(task.path);
      //Read the file if we don't have it yet
      if (!files[task.path]) {
        self.pause(task.path);
        files[task.path] = fs.readFileSync(fullPath, "utf8");
      }
      
      task.order = index*10;
      files[task.path] = self.modifyTask(files[task.path], task);
    });
  }

  //write all files and unpause
  _.each(files, function(data, path) {
    fs.writeFileSync(self.fullPath(path), data, "utf8");
    if (self.isPaused(path)) self.unpause(path);
  });

  //process all files
  var fileNames = _.keys(files);
  self.processFiles(fileNames, function() {
    // [Document afterMoveTask in example config and README.md](#doing:20)
    // if (_.isFunction(self.config.afterMoveTask)) {
    //   procee.nextTick(function() {
    //     self.config.afterMoveTask(fileNames);
    //   });
    // }
    
    if (_.isFunction(callback)) callback();
  });

};

imdone.Project.prototype.relativePath = function(file) {
  return file.replace(this.path + "/", "");
};

imdone.Project.prototype.fullPath = function(file) {
  if (file.indexOf(this.path) < 0) file = this.path + "/" + file;
  return file;
};


imdone.Project.prototype.modifyTask = function(data,task) {
  var file = {content:data, path:task.path};

  tasks.modifyTask(file, task);

  return file.content;
};

imdone.Project.prototype.filesToProcess = function(files, showDirs) {
  var self = this;
  var passed = [];

  _.each(files, function(file, i) {
    file = self.fullPath(file);
    var relPathFile = self.relativePath(file);
    if (self.config.include.test(relPathFile)  && 
        !self.config.exclude.test(relPathFile) && 
        (fs.statSync(file).isFile() || showDirs)) {
      passed.push(file);
    }
  });

  return passed;
};

imdone.Project.prototype.processFiles = function(files, callback) {
  try {
    var self = this;
    files = this.filesToProcess(files);

    var remaining = _.without(files);
    var isComplete = function(val) {
      remaining = _.without(remaining, val);
      //console.log("fles left to process:" + remaining.length);
      self.processing = (remaining.length > 0);
      return !self.processing;
    };

    _.each(files, function(file, i) {
      self.processing = true;
      var fullPathFile = self.fullPath(file);
      var relPathFile = self.relativePath(file);
      //console.log("Extracting tasks from file: " + fullPathFile);
      //for each file get the tasks
      //[Make this an async file read](#archive:300)
      var data = fs.readFile(fullPathFile, 'utf8', function (err, data) {
        if (err) {
          console.log("Unable to open file:", err);
          return;
        }
        var lastUpdate = new Date(fs.statSync(fullPathFile).mtime);
        delete self.tasks[relPathFile];
        self.tasks[relPathFile] = {lastUpdate:lastUpdate};
        self.lastUpdate = lastUpdate;

        self.tasks[relPathFile].tasks = tasks.getTasks(data, file, function(task) {
          _.extend(task, {
            path:relPathFile,
            project:self.path,
            location: self.location(),
            url: self.getURL(relPathFile, task.line),
            lastUpdate:lastUpdate
          });

          return task;
        });

        if (isComplete(file)) {
          self.saveListData();
          //check to see if files still exist
          //console.log("tasks:" + JSON.stringify(self.tasks, null, "   "));
          if (callback) callback();
        }
      });
    });
  } catch(e) {
    console.log(e.message);
    this.processing = false;
  }
};

imdone.Project.prototype.update = function(files) {
  var self = this;
  _.each(files, function(file) {
    if (!self.isPaused(file)) {
      //[Store last updated time, and check to see if we should process - 0.1.3](#archive:340)
      self.processFiles([file]);  
    }
  });
};

imdone.Project.prototype.pause = function(file) {
  console.log("***Pausing: " + file);
  this.pause[file] = true;
};

imdone.Project.prototype.isPaused = function(file) {
  return this.pause[file] !== undefined;
};

imdone.Project.prototype.unpause = function(file) {
  if (this.pause[file]) {
    console.log("***Unpausing: " + file);
    this.processFiles([file]);
    delete this.pause[file];
  }
};

imdone.Project.prototype.watchFiles = function(path) {
  //[Test watchr on hundreds of directories](#todo:80)
  var self = this;
  watchr.watch({
      path: path,
      ignoreCommonPatterns:true,
      //[Use ignoreCustomPatterns](#archive:290)
      ignoreCustomPatterns:self.config.exclude,
      listeners: {
          /*
          log: function(logLevel){
              console.log('a log message occured:', arguments);
          },
          */
          error: function(err){
              console.error('an error occured:', err);
          },
          watching: function(err,watcherInstance,isWatching){
              //console.log('a new watcher instance finished setting up', arguments);
              console.log('a new watcher instance finished setting up');
          },
          change: function(changeType,filePath,fileCurrentStat,filePreviousStat){
              //console.log('a change event occured:',arguments);
              console.log("an " + changeType + " occured on " + filePath);
              if (filePath.match(self.config.exclude) != null) return;
              switch(changeType) {
                case "update":
                  console.log("Processing update to:",filePath);
                  var process = true;
                  if (self.tasks[filePath]) {
                    var lastModified = new Date(fileCurrentStat.mtime);
                    if (lastModified > self.tasks[filePath].lastUpdate) {
                      process = true;
                    } else {
                      process = false;
                    }
                  }
                  if (process) self.update([filePath]);
                  break;
                case "create":
                  console.log("Processing create of:",filePath);
                  self.processFiles([filePath]);
                  break;
                case "delete":
                  console.log("Processing delete of:",filePath);
                  delete self.tasks[filePath];
                  self.saveListData();
                  break;
              }
          }
      },
      next: function(err,watchers){
          console.log('watching for all our paths has completed');
          //console.log('watching for all our paths has completed', arguments);
      }
  });

};

/*
  - [Modify $HOME/.imdone/config.js to edit the project directories watched by imdone](#todo:90)
  - [Modify process.env to contain the port info for cliService](#archive:220)

*/
imdone.Project.prototype.initConfig = function(callback) {
  this.dataDir = this.path + "/imdone";
  var self = this;

  //Check for the imdone directory
  if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir);

  this.configFile = this.dataDir + "/config.js";
  this.defaultConfig = "./config";
  
  //Extend the default config
  var config = require(this.defaultConfig);
  this.config = _.extend({}, config);

  if (fs.existsSync(this.configFile)) {
    console.log("Found imdone config file:" + this.configFile);
    _.extend(this.config,require(this.configFile));
  } else {
    var defaultConfigPath = require.resolve(this.defaultConfig);
    var inStr = fs.createReadStream(defaultConfigPath);
    var outStr = fs.createWriteStream(this.configFile);
    console.log("copying " + defaultConfigPath + " to " + this.configFile);
    inStr.pipe(outStr);  
  }
  marked.setOptions(this.config.marked);

  this.config.lists = this.config.lists || [];
  this.config.path = this.path;
  console.log("Loaded config:" + JSON.stringify(this.config, function(key, val) {
    if (/(include|exclude)/.test(key)) {
      return val.toString();
    } else {
      return val;
    }
  }, 3));

  this.dataFile = this.dataDir + "/data.js";

  if (callback) callback();

};

imdone.Project.prototype.loadListData = function(callback) {
  var self = this;
  this.lists = [];
  //Get the lists from the data file
  fs.exists(this.dataFile, function(exists) {
    if (exists) {
      fs.readFile(self.dataFile, 'utf8', function(error, data) {
        self.config.lists = self.config.lists || [];
        var fileData  = JSON.parse(data);
        if (_.isArray(fileData)) {
          //for backward compatability
          self.lists = fileData;
        } else if (_.isObject(fileData)) {
          self.lists = fileData.lists;
          self.hidden = fileData.hidden || [];
        }
        //printjson(imdone.lists);
        if (callback) callback();
      });
    } else {
      if (callback) callback();
    }
  });
};

imdone.Project.prototype.saveListData = function() {
  var currentLists = this.lists;
  var self = this;

  _.each(self.tasks, function(fileTasks, file){
    _.each(fileTasks.tasks,function(task, id) {
      if (!_.contains(currentLists, task.list)) currentLists.push(task.list);
    });
  });
  
  //console.log("currentLists:" + JSON.stringify(currentLists, null, 2));


  var intersection = _.intersection(this.lists, currentLists);

  //console.log("Intersection:" + JSON.stringify(intersection, null, 2));

  this.lists = _.union(intersection, currentLists);
  this.hidden = this.hidden || [];
  //now find the hidden lists that aren't in the lists and remove them from both
  var defunct = _.difference(self.hidden, self.lists);
  if (defunct) console.log("Defunct hidden lists:" + JSON.stringify(defunct, null, 2));
  _.each(defunct, function(list) {
    console.log("Removing " + list + " from hidden lists.");
    self.hidden = _.without(self.hidden, list);
  });

  var fileData = {lists:self.lists, hidden:self.hidden};
  console.log("Saving iMDone data: " + JSON.stringify(fileData, null, 2));
  fs.writeFileSync(this.dataFile, JSON.stringify(fileData, null, 2), 'utf8');
};