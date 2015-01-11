var WebSocketConnection = function() {    
	
    function eventToState(state) 
    function stateTransition(toState)
    function runStateTransition(previousState, toState) {
            case "init":
                {
                    m_Socket = io.connect("http://" + m_Host + ":" + m_Port, m_SocketOptions);
                    m_Socket.on("connect", eventToState("connect"));
                    m_Socket.on("reconnect_attempt", eventToState("reconnect_attempt"));
                    m_Socket.on("reconnect", eventToState("reconnect"));
                    m_Socket.on("reconnect_error", eventToState("reconnect_error"));
                    m_Socket.on("reconnect_failed", eventToState("reconnect_failed"));
                    m_Socket.on("connect_error", eventToState("error"));
                    m_Socket.on("disconnect", eventToState("disconnect"));
                    m_Socket.on("try_again", eventToState("try_again"));
                    m_Socket.on("force_disconnect", eventToState("force_disconnect"));
                    m_Socket.on("server_error", eventToState("server_error"));
                    m_Socket.on("kick", eventToState("kick"));
                    m_Socket.on("ping", function() {
                        m_Socket.emit("pong")
                    });
                    m_Socket.on("set_refresh_wait", function(wait) {
                        m_RefreshWait = parseInt(wait, 10)
                    });
                    m_Application.bindApplicationSocketEvents(m_Socket);
                    stateTransition("waitingForConnection")
                }
                break;
            case "waitingForConnection":             
            case "connect":
                {
                    exitFailureState();
                    if (previousState != "waitingForConnection" && previousState != "reconnect") {
                        console.error("transition from " + previousState + " to connect is unexpected")
                    }
                    m_ConnectedOnce = true;
                    stateTransition("connected")
                }
                break;
            case "connected":               
            case "manualReconnect":              
            case "reconnect_attempt":               
            case "reconnect":              
            case "reconnect_error":                
            case "reconnect_failed":               
            case "try_again":                
            case "disconnect":               
            case "error":              
            case "force_disconnect":             
            case "connectionReset":               
            case "server_error":              
            case "kick":               
            case "idle":
            case "pauseBeforeReconnection":
            case "finished":
        }
    }
    function enterFailureState()
    function testFailureStateRefresh() 
    function exitFailureState()  
};
var PlayerModules;
var gErrors = {networkError: "Network error. Please try again.",noCookie: "Your browser is sending a bad request. Are you running some dodgy extension?",badCookie: "Authentication cookie cannot be read. Are you staff and do you have a dev cookie?",noAuthCookie: "Your browser is not allowing cookies or your cookie is damaged. Try clearing your cookies and refresh.",noUserRecord: "Darn! There's a problem with your session. Try logging out and back in. If that doesn't help then there's a bigger problem, we've been notified and we're working on it. Refreshing over and over won't help. Try back in a few minutes.",haxor: "Go away script kiddie! Your mommy is calling you.",throttleUp: 'Your cooldown has been raised to %throttle% seconds. <a href="%refUrl%" target="_blank">Refer to this for more info</a>',throttleDown: "Your cooldown has been lowered to %throttle% seconds.",banned: 'Oops! You were naughty and got banned. You can watch the fun but cannot participate. <a href="%refUrl%" target="_blank">Refer to this for more info.</a>',unbanned: "Your ban has been lifted. Someone must like you. Don't disappoint them!",notResponding: "The chat server isn't responding right now. Please be patient, we'll keep trying to connect. Refreshing will only move you to the back of the queue...",notLookingGood: "Darn, the server is not responding and at this point there's not much of a chance that it will. We'll keep trying though...",giveUp: "OK, we give up. The server is just not there.",longLogin: "Connecting...",disconnect: "Connection lost. Reconnecting...",tryAgain: "Sorry! The servers are really busy right now. You're in a queue and will be connected soon...",dumbBrowser: "Sorry! It seems your browser has given up... You can try refreshing now. If that doesn't help, check your network connection.",stillWaiting: "Still waiting to reconnect. Refreshing makes it worse.",whyYouHitF5: "Please don't refresh. We are trying to connect and if you can get in, you will get in.",badConfig: "Oops, Something's jacked up. Try logging out then logging back in or clear your cookies and log back in. If that doesn't help, we suck and you should mock us in the bug reporting forum.",serverReset: "Sorry! The server is being reset. You will reconnect in 10 seconds.",kicked: "You have been disconnected from the server by an administrator. Probably to upgrade or fix the server. Sorry about that. You will be reconnected in %1% seconds.",forceDisconnect: "The server has closed the connection, probably because you logged in elsewhere.",unknown: "Wow, things are so bad the server is telling us about a problem that we can't even understand enough to tell you about. The world may be ending. Don't look outside",eoo: null};
var URL_REGEX = /((((http|https)\:\/\/)|(www\.))+(([a-zA-Z0-9\._\-\:\(\)]+\.[a-zA-Z]{2,6})|([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}))(\/[a-zA-Z0-9\?\=\&amp;%_\.\/\-~\-]*)?)/g;
var Chat = function() {
   
    var 
    function bindSocketEvents(socket)
        m_Socket.on("initialize", function(user, options)
        m_Socket.on("initialize_chat", function(options)
        m_Socket.on("initialize_messages", function(data) 
        m_Socket.on("initialize_mod_messages", function(data)
        m_Socket.on("initialize_moderators", function(data)
        m_Socket.on("initialize_staff", function(data) 
        m_Socket.on("user_list", function(users) 
        m_Socket.on("too_busy", function() 
        m_Socket.on("receive_message", function(data)
        m_Socket.on("receive_mod_message", function(data)
        m_Socket.on("receive_warning_message", function(data)
        m_Socket.on("user_joined", function(user)
        m_Socket.on("user_left", function(user) 
        m_Socket.on("update_user_count", function(data) 
        m_Socket.on("moderator_joined", function(user) 
        m_Socket.on("moderator_left", function(user)
        m_Socket.on("staff_joined", function(user) 
        m_Socket.on("staff_left", function(user) 
        m_Socket.on("global_throttle_changed", function(data, moderator)
        m_Socket.on("mod_alert", function(alert)
        m_Socket.on("forceRefresh", function() 
        m_Socket.on("full_reset", function()
        m_Socket.on("you_are_on", function(server)
        m_Socket.on("new_livestream", function() 
        m_Socket.on("set_notification", function(notification)
        m_Socket.on("mod_action", function(action) {
            var message = "You got moderated!";
            switch (action.action) {
                case "user_throttle":
                case "ban":
                case "unban":
            }
        });
        m_Socket.on("message_deleted", function(data)
       
    }
    function bindControls() 
    function waitForEcho() 
    function receivedEcho() 
    function updateUserCount()
    function checkForUserCallout()
    function addCalloutUser(username)
    function insertUserMessage(user, messageId, message, replyToId, replyToUsers, modMessage)
    function insertUserIntoList(user) 
    function convertLinks(html) 
    function convertLinksAndEmoticons(user, spanMessage)
    function getUserAttributes(user) 
    function missedMessages(target, watch) 
    function scrollHoldFn(element, target)
    function insertMessage(element)
    function insertModMessage(element)
    function throttleTimer()
    function insertStaff(user)
    function deleteStaff(user)
    function insertModerator(user)
    function deleteModerator(user)
    function insertAlertMessage(msg) 
    function insertModAlertMessage(msg) 
    function _removeBannerFn(target)
    function updateBanner(which) 
    function _switchInput(chatbox) 
};
$(document).ready(function() {
    
    var chat = new Chat;
    AjaxApiRequest.makeGetApiRequest("/chat/chatInit", params, function(result) 
    function _error() 
    function checkMultiplePlayers() 
});
