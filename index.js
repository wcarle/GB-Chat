var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

var users = [];
var messages = [];

io.on('connection', function(socket){
	console.log('User Connected');
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

	socket.on('send_message', function (msg) {
		console.log('message: ' + msg.username + ': ' + msg.message)
		addMessage(msg);
		io.emit('recieve_message', msg)
	})
	socket.on('user_join', function (username) {
		console.log('user joined: ' + username);
		var user = {id: socket.id, username: username};
		users.push(user);
		socket.broadcast.emit('user_joined', user);
		socket.emit('init', {users: users, messages: messages});
	})
})

http.listen(3000, function(){
  console.log('listening on *:3000');
});
function addMessage(message){
	if(messages.length == 20){
		messages.splice(0, 1);
	}
	messages.push(message);
}
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
