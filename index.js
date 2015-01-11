var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});
app.use('/public', express.static(__dirname + '/public'));

var cooldown = 10000;
var users = [];
var messages = [];

io.on('connection', function(socket){
	console.log('User Connected');
	socket.on('pong', function(data){
        //ping pong
    });

    //User disconnect event
	socket.on('disconnect', function(){
		console.log('User Disconnected');
		var user = getUser(socket.id);
		if(user){
			users.splice(users.indexOf(user), 1);
			io.emit('user_left', user.username);
		}
		else{
			console.log("user not found");
		}
	})
	//User sent message
	socket.on('send_message', function (msg) {
		var user = getUser(socket.id);
		//Check if user can submit another message
		if(!user.lastMessage || user.lastMessage.getTime() + cooldown < new Date().getTime()){
			console.log('message: ' + msg.username + ': ' + msg.message);
			addMessage(msg);
			user.lastMessage = new Date();
			io.emit('recieve_message', msg);
		}
	})
	//New user joined
	socket.on('user_join', function (username) {
		console.log('user joined: ' + username);
		var user = {id: socket.id, username: username};
		users.push(user);
		//Send to everybody except joining user
		socket.broadcast.emit('user_joined', user);
		socket.emit('init', {users: users, messages: messages});
	})
})

http.listen(3000, function(){
  console.log('listening on *:3000');
});

//Play some ping pong to keep idle connections alive
setTimeout(letsPlayAGame, 60000);
function letsPlayAGame(){
    setTimeout(letsPlayAGame, 60000);
    io.sockets.emit('ping', { ball : 1 });
}

//Add messages to message list, store a max of 20 to populate new users' list
function addMessage(message){
	if(messages.length == 20){
		messages.splice(0, 1);
	}
	messages.push(message);
}
//Get user given socket id, normally we would use auth to track users
function getUser(socket){
	var found = null;
	users.forEach(function (user, i) {
		if(user.id == socket){
			found = user;
			return;
		}
	})
	return found;
}
