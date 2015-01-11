var WebSocketConnection = function() {
    var exports = {initialize: function(websocketCallbackInterface) {
            m_Application = websocketCallbackInterface;
            m_LameMode = onIE() || onMobile()
        },connect: function(host, port, options) {
            if (m_StateMachine) {
                throw "Connection state machine already running. Don't do it twice. Make better...."
            }
            m_Host = host;
            m_Port = port;
            m_SocketOptions = {transports: ["websocket"],reconnectionAttempts: 30,reconnectionDelayMax: 8e3,reconnect: true,forceNew: true};
            if (m_LameMode) {
                if (options.allowXHRPolling) {
                    m_SocketOptions.transports.push("polling")
                }
            }
            var waitTime = 0;
            if (localStorage.nextReconnectTime) {
                var now = (new Date).getTime();
                var reconnectTime = parseInt(localStorage.nextReconnectTime, 10);
                if (now >= reconnectTime) {
                    delete localStorage.nextReconnectTime
                } else {
                    waitTime = reconnectTime - now;
                    m_Application.setConnectionAlert("stillWaiting", true)
                }
            } else {
                if (!options.noWait && testFailureStateRefresh()) {
                    m_Application.setConnectionAlert("whyYouHitF5", true);
                    var xx = "constant refreshes overload the servers and make it hard for everyone else. this is why you are being forced to wait. i promise, the chat client will keep retrying until it connects. you dont need to refresh.";
                    waitTime = 6e4
                }
            }
            setTimeout(function() {
                m_State = "idle";
                stateTransition("init")
            }, waitTime)
        },swapConnection: function(host, port, options) {
            if (!m_StateMachine) {
                return exports.connect(host, port, options)
            }
            if (m_Socket) {
                m_Socket.disconnect();
                delete m_Socket;
                m_Socket = null
            }
            var socketHash = "http://" + m_Host + ":" + m_Port;
            if (io.sockets[socketHash]) {
                delete io.sockets[socketHash]
            }
        },disableConnectionUntil: function(nextConnectTime) {
            localStorage.nextReconnectTime = nextConnectTime
        },setRefreshWait: function(refreshWait) {
            m_RefreshWait = refreshWait
        }};
    function eventToState(state) {
        return function() {
            stateTransition.apply(this, [state].concat([].slice.call(arguments, 0)))
        }
    }
    function stateTransition(toState) {
        if (m_State == "finished") {
            return
        }
        var args = [].slice.call(arguments, 0);
        var previousState = m_State;
        m_State = toState;
        runStateTransition.apply(this, [previousState].concat(args))
    }
    function runStateTransition(previousState, toState) {
        console.log("state transition from " + previousState + " to " + m_State);
        var transitionArgs = [].slice.call(arguments, 2);
        switch (m_State) {
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
                {
                    if (m_WaitingTimeout || m_ReconnectAttempts > 9) {
                        break
                    }
                    m_WaitingTimeout = setTimeout(function() {
                        m_WaitingTimeout = null;
                        if (m_State == "connected" || m_State == "finished") {
                            return
                        }
                        enterFailureState();
                        m_Application.setConnectionAlert(m_ConnectedOnce ? "disconnect" : "longLogin")
                    }, 4e3)
                }
                break;
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
                {
                    m_ReconnectAttempts = 0;
                    m_ConnectionRetryMultiplier = 1;
                    m_Application.setConnectionAlert(null);
                    m_Application.setUIConnectionState("connected")
                }
                break;
            case "manualReconnect":
                {
                    m_Socket.connect();
                    stateTransition("waitingForConnection")
                }
                break;
            case "reconnect_attempt":
                {
                    var currentReconnectDelay = transitionArgs[0];
                    m_ReconnectAttempts++;
                    console.log("reconnecting", currentReconnectDelay, m_ReconnectAttempts);
                    if (m_ReconnectStartTimeout) {
                        clearTimeout(m_ReconnectStartTimeout);
                        m_ReconnectStartTimeout = null
                    }
                    if (currentReconnectDelay > 8e3) {
                        m_Socket.socket.reconnectionDelay = 8e3
                    }
                    if (m_ReconnectAttempts == 10) {
                        m_Application.setConnectionAlert("notResponding", true)
                    } else if (m_ReconnectAttempts == 15) {
                        m_Application.setConnectionAlert("notLookingGood", true)
                    } else if (m_ReconnectAttempts == 30) {
                        m_Application.setConnectionAlert("giveUp", true)
                    }
                    stateTransition("waitingForConnection")
                }
                break;
            case "reconnect":
                {
                    var method = m_Socket.io.engine.transport.query.transport;
                    console.log("reconnect", method);
                    if (!m_LameMode && method != "websocket") {
                        exitFailureState();
                        m_Socket.disconnect();
                        m_Application.setConnectionAlert("dumbBrowser", true)
                    }
                }
                break;
            case "reconnect_error":
                {
                    var error = transitionArgs[0];
                    console.log("reconnect_error")
                }
                break;
            case "reconnect_failed":
                {
                    console.log("reconnect_error")
                }
                break;
            case "try_again":
                {
                    m_Application.setConnectionAlert("tryAgain", true);
                    m_AllowReconnect = true;
                    m_ConnectionRetryMultiplier = 1;
                    stateTransition("waitingForConnection")
                }
                break;
            case "disconnect":
                {
                    var how = transitionArgs[0];
                    console.log("disconnected " + (how ? how : ""));
                    m_Application.setUIConnectionState("disconnected");
                    if (how == "io server disconnect") {
                        if (m_AllowReconnect) {
                            var nextReconnectTime = localStorage.nextReconnectTime ? localStorage.nextReconnectTime - (new Date).getTime() : 0;
                            setTimeout(function() {
                                stateTransition("manualReconnect")
                            }, nextReconnectTime);
                            if (localStorage.nextReconnectTime) {
                                stateTransition("pauseBeforeReconnection", nextReconnectTime)
                            } else {
                                stateTransition("waitingForConnection")
                            }
                        }
                    } else if (how == "io client disconnect" || how == "forced close") {
                        m_AllowReconnect = false;
                        stateTransition("finished")
                    } else {
                        m_ReconnectStartTimeout = setTimeout(function() {
                            exitFailureState();
                            m_Application.setConnectionAlert("dumbBrowser")
                        }, 6e3);
                        stateTransition("waitingForConnection")
                    }
                }
                break;
            case "error":
                {
                    var reason = transitionArgs[0];
                    enterFailureState();
                    m_Application.setUIConnectionState("disconnected");
                    if (typeof reason == "object") {
                        try {
                            reason = reason.toString()
                        } catch (e) {
                            reason = JSON.stringify(reason)
                        }
                    }
                    if (reason !== "") {
                        console.log("connection failure reason: ", reason)
                    } else {
                        console.log("connection failed and we don't know why because of a crappy SocketIO programmer who provides no errors.")
                    }
                    stateTransition("idle")
                }
                break;
            case "force_disconnect":
                {
                    m_AllowReconnect = false;
                    m_Application.setConnectionAlert("forceDisconnect", true);
                    m_Application.setUIConnectionState("disconnected");
                    stateTransition("finished")
                }
                break;
            case "connectionReset":
                {
                    console.log("connectionReset");
                    stateTransition("idle")
                }
                break;
            case "server_error":
                {
                    var errorCode = transitionArgs[0];
                    var guruDebugMeditation = transitionArgs[1];
                    console.log("server error " + errorCode);
                    if (guruDebugMeditation) {
                        console.log("chat guru debug meditation:\n" + guruDebugMeditation)
                    }
                    m_Application.setServerError(errorCode);
                    m_AllowReconnect = false;
                    stateTransition("idle")
                }
                break;
            case "kick":
                {
                    var forceReload = transitionArgs[0];
                    var waitTimeToReconnect = transitionArgs[1];
                    if (forceReload) {
                        location.reload()
                    } else {
                        if (!waitTimeToReconnect) {
                            waitTimeToReconnect = m_RefreshWait
                        } else {
                            waitTimeToReconnect = m_RefreshWait + waitTimeToReconnect
                        }
                        if (waitTimeToReconnect) {
                            exports.disableConnectionUntil((new Date).getTime() + parseInt(waitTimeToReconnect, 10))
                        }
                        m_Application.setConnectionAlert("kicked", true, waitTimeToReconnect / 1e3)
                    }
                }
                break;
            case "idle":
            case "pauseBeforeReconnection":
            case "finished":
                {
                }
                break
        }
    }
    function enterFailureState() {
        localStorage.inFailureState = true;
        localStorage.failureStateTime = (new Date).getTime()
    }
    function testFailureStateRefresh() {
        if (!localStorage.inFailureState || !localStorage.failureStateTime) {
            return false
        }
        var now = (new Date).getTime();
        var timeSinceLastFailure = now - localStorage.failureStateTime;
        if (timeSinceLastFailure < 3e4) {
            return true
        } else {
            exitFailureState()
        }
    }
    function exitFailureState() {
        localStorage.inFailureState = false;
        localStorage.failureStateTime = null
    }
    var m_Application = null;
    var m_Socket = null;
    var m_Host = null;
    var m_Port = null;
    var m_SocketOptions = null;
    var m_ConnectionRetryMultiplier = 1;
    var m_ReconnectStartTimeout = null;
    var m_State = null;
    var m_ReconnectAttempts = 0;
    var m_StateMachine = null;
    var m_LameMode = false;
    var m_WaitingTimeout = null;
    var m_ConnectedOnce = false;
    var m_AllowReconnect = true;
    var m_RefreshWait = 0;
    return exports
};
var PlayerModules;
if (!PlayerModules)
    PlayerModules = [];
var gErrors = {networkError: "Network error. Please try again.",noCookie: "Your browser is sending a bad request. Are you running some dodgy extension?",badCookie: "Authentication cookie cannot be read. Are you staff and do you have a dev cookie?",noAuthCookie: "Your browser is not allowing cookies or your cookie is damaged. Try clearing your cookies and refresh.",noUserRecord: "Darn! There's a problem with your session. Try logging out and back in. If that doesn't help then there's a bigger problem, we've been notified and we're working on it. Refreshing over and over won't help. Try back in a few minutes.",haxor: "Go away script kiddie! Your mommy is calling you.",throttleUp: 'Your cooldown has been raised to %throttle% seconds. <a href="%refUrl%" target="_blank">Refer to this for more info</a>',throttleDown: "Your cooldown has been lowered to %throttle% seconds.",banned: 'Oops! You were naughty and got banned. You can watch the fun but cannot participate. <a href="%refUrl%" target="_blank">Refer to this for more info.</a>',unbanned: "Your ban has been lifted. Someone must like you. Don't disappoint them!",notResponding: "The chat server isn't responding right now. Please be patient, we'll keep trying to connect. Refreshing will only move you to the back of the queue...",notLookingGood: "Darn, the server is not responding and at this point there's not much of a chance that it will. We'll keep trying though...",giveUp: "OK, we give up. The server is just not there.",longLogin: "Connecting...",disconnect: "Connection lost. Reconnecting...",tryAgain: "Sorry! The servers are really busy right now. You're in a queue and will be connected soon...",dumbBrowser: "Sorry! It seems your browser has given up... You can try refreshing now. If that doesn't help, check your network connection.",stillWaiting: "Still waiting to reconnect. Refreshing makes it worse.",whyYouHitF5: "Please don't refresh. We are trying to connect and if you can get in, you will get in.",badConfig: "Oops, Something's jacked up. Try logging out then logging back in or clear your cookies and log back in. If that doesn't help, we suck and you should mock us in the bug reporting forum.",serverReset: "Sorry! The server is being reset. You will reconnect in 10 seconds.",kicked: "You have been disconnected from the server by an administrator. Probably to upgrade or fix the server. Sorry about that. You will be reconnected in %1% seconds.",forceDisconnect: "The server has closed the connection, probably because you logged in elsewhere.",unknown: "Wow, things are so bad the server is telling us about a problem that we can't even understand enough to tell you about. The world may be ending. Don't look outside",eoo: null};
var URL_REGEX = /((((http|https)\:\/\/)|(www\.))+(([a-zA-Z0-9\._\-\:\(\)]+\.[a-zA-Z]{2,6})|([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}))(\/[a-zA-Z0-9\?\=\&amp;%_\.\/\-~\-]*)?)/g;
var Chat = function() {
    var exports = {initialize: function(options, completionFn) {
            m_ChatOptions = options;
            m_loginMessage = m_ChatOptions.message;
            f_event = $("#js-event");
            f_themeCompact = $("#js-themeCompact");
            f_themeCozy = $("#js-themeCozy");
            f_ConversationMainPanel = $("#conversation-main");
            f_ConversationModPanel = $("#conversation-mod");
            f_ConversationRepliesPanel = $("#conversation-replies");
            f_ConversationFollowsPanel = $("#conversation-follows");
            f_PollPanel = $("#conversation-poll");
            f_PollTab = $("#pollTab");
            f_History = $("#f_History");
            f_MainConversation = f_ConversationMainPanel.find(".js-conversation");
            f_ConversationReplies = f_ConversationRepliesPanel.find(".js-conversation");
            f_OnlineUsersList = $("#f_OnlineUsersList");
            f_Alert = $("#f_Alert");
            f_ChatController = $("#f_ChatController");
            f_MainConversationTab = $("#chatTab");
            f_ModConversationTab = $("#modChatTab");
            f_ConversationRepliesTab = $("#repliesTab");
            f_OnlineUsersListTab = $("#usersTab");
            f_tabToggle = $("#chatTabsToggle");
            f_tabPrefs = $("#js-chat-tabs-prefs");
            f_tabToggleParent = f_ChatController;
            f_ChatArea = $("#f_ChatArea");
            f_ChatForm = $("#chat-form");
            f_WarningBox = $("#warningbox");
            f_UserCount = $("#user-count");
            f_AnonymousUserCount = $("#f_AnonymousUserCount");
            f_CharCount = $("#charCount");
            f_ModListContainer = $("#mod-duders");
            f_ModList = $("#mod-list");
            f_RoomsListContainer = $("#f_RoomsListContainer");
            f_RoomsList = $("#f_RoomsList");
            f_StaffListContainer = $("#staff-duders");
            f_StaffList = $("#staff-list");
            f_ChatInput = $("#f_ChatInput");
            f_MainInput = $("#f_MainInput");
            f_RepliesInput = $("#f_RepliesInput");
            f_FriendsInput = $("#f_FriendsInput");
            f_MainChatInteract = $(".main_chat-speak__interact");
            f_ModChatInteract = $(".mod_chat-speak__interact");
            f_RepliesChatInteract = $(".replies_chat-speak__interact");
            f_FriendsChatInteract = $(".friends_chat-speak__interact");
            f_ReplyToList = $("#f_ReplyToList");
            f_WaitForThrottleMsg = $("#chillpill");
            f_ThrottleTime = $("#throttle_countdown");
            f_GlobalThrottleTime = $("#global-throttle");
            if (m_ChatOptions.userIsModOrStaff) {
                f_GlobalThrottleField = $("#f_ThrottleValue");
                f_ModConversation = f_ConversationModPanel.find(".js-conversation");
                f_FloatingMod = $("#floatingModContainer");
                f_FloatingModTimeout = $("#floatingMod-timeout");
                f_FloatingModWatch = $("#floatingMod-watch");
                f_FloatingModUnwatch = $("#floatingMod-unwatch");
                f_ModerationModUser = $("#floatingMod-username");
                f_ModUsernameDisplay = $("#floatingMod-username-display");
                f_ModerationWarningMessage = $("#floatingMod-warning-msg");
                f_TopBannerInput = $("#f_TopBannerInput");
                f_BottomBannerInput = $("#f_BottomBannerInput");
                m_ModPopover = new PhoenixChatPopover;
                m_ModPopover.init(f_FloatingMod)
            }
            if (StreamOptions.disableAvatars) {
                $(".chat").addClass("no-avatar")
            }
            f_chatCountMax = $(".chat-count-max");
            m_maxMessageLength = 255;
            f_chatCountMax.text("/ " + m_maxMessageLength);
            m_ChatItemTemplate = Handlebars.templates.chatItem;
            m_ReplyToChatItemTemplate = Handlebars.templates.replyToChatItem;
            m_ErrorItemTemplate = Handlebars.templates.errorItem;
            m_MessageItemTemplate = Handlebars.templates.messageItem;
            m_GeneralMessageTemplate = Handlebars.templates.generalMessage;
            m_NoticeTemplate = Handlebars.templates.notice;
            m_ModListItemTemplate = Handlebars.templates.modlistItem;
            m_RoomListItemTemplate = Handlebars.templates.roomListItem;
            m_UserItemTemplate = Handlebars.templates.userItem;
            m_UserItemNoModTemplate = Handlebars.templates.userItemNoMod;
            m_ReplyToItemTemplate = Handlebars.templates.replyToListItem;
            m_panelCount = 1;
            m_panelParent = $("#chat-canvas");
            m_panels = m_panelParent.children();
            m_activePanel = "main";
            m_panelMaxHeight = 100;
            m_chatToggle = $(".js-chatDesignate");
            m_chatSpeak = $(".js-chatSpeak");
            m_chatSpeakInput = m_chatSpeak.find(".js-chatInput");
            m_chatSpeakInputPad = m_chatSpeakInput.css("padding-left");
            m_switchMainInput = _switchInput("main");
            m_switchModInput = _switchInput("mod");
            m_DefaultAvatarPath = "http://static.giantbomb.com/uploads/square_tiny/0/22/176637-default.png";
            $(".xperimental").hide();
            f_WaitForThrottleMsg.hide();
            bindControls();
            f_ChatArea.hide();
            f_ThrottleTime.text(0);
            $("#f_UserStats").hide();
            $("#f_AnonymousStats").hide();
            PlayerModules.forEach(function(module) {
                module.initialize(playerModuleExports)
            });
            AjaxApiRequest.makeGetApiRequest("/chat/emoticons", [], function(data) {
                m_Emoticons = data;
                completionFn()
            })
        },error: function(msg) {
            if (!f_Alert) {
                f_Alert = $("#f_Alert");
                f_ChatArea = $("#f_ChatArea");
                m_ErrorItemTemplate = Handlebars.templates.errorItem
            }
            f_Alert.empty().append(m_ErrorItemTemplate({message: msg})).removeClass("hide");
            f_ChatArea.hide()
        },connect: function() {
            m_WebSocketConnection = new WebSocketConnection;
            m_WebSocketConnection.initialize(websocketCallbackInterface);
            m_WebSocketConnection.connect(m_ChatOptions.chatHost, m_ChatOptions.chatPort, m_ChatOptions)
        },eoo: null};
    var playerModuleExports = {getCurrentUser: function() {
            return m_CurrentUser
        },eoo: null};
    var websocketCallbackInterface = {bindApplicationSocketEvents: function(socket) {
            bindSocketEvents(socket)
        },setUIConnectionState: function(state) {
            switch (state) {
                case "connected":
                    f_ChatArea.show();
                    break;
                case "disconnected":
                    f_ChatArea.hide();
                    break
            }
        },setConnectionAlert: function(messageCode, critical) {
            if (messageCode == m_CurrentConnectionAlertMessageCode) {
                return
            }
            if (m_ConnectionAlertAnimationInterval) {
                clearInterval(m_ConnectionAlertAnimationInterval)
            }
            m_CurrentConnectionAlertMessageCode = messageCode;
            if (messageCode) {
                var message = gErrors[messageCode] ? gErrors[messageCode] : gErrors.unknown;
                if (arguments.length > 2) {
                    for (var i = 0; i < arguments.length; i++) {
                        message = message.replace(new RegExp("%" + (i + 2) + "%", "g"), arguments[i + 1])
                    }
                }
                var template = critical ? m_ErrorItemTemplate : m_MessageItemTemplate;
                var messageElement = template({message: message});
                f_Alert.empty().append(messageElement).removeClass("hide");
                if (message.substr(-3, 3) == "...") {
                    m_ConnectionAlertAnimationFrames = 0;
                    m_ConnectionAlertAnimationInterval = setInterval(function() {
                        if (++m_ConnectionAlertAnimationFrames > 5) {
                            f_Alert.empty().append(messageElement);
                            m_ConnectionAlertAnimationFrames = 0
                        } else {
                            f_Alert.find(".chat-alert__item").append(".")
                        }
                    }, 1e3)
                }
            } else {
                f_Alert.addClass("hide")
            }
        },setServerError: function(errorCode) {
            var message = gErrors[errorCode] ? gErrors[errorCode] : gErrors.unknown;
            var error = m_ErrorItemTemplate({message: message});
            insertMessage($(error)[0])
        }};
    function bindSocketEvents(socket) {
        m_Socket = socket;
        m_Socket.on("initialize", function(user, options) {
            m_CurrentUser = user;
            m_TopBannerText = options.topNotification || "";
            m_BottomBannerText = options.bottomNotification || "";
            updateBanner("top");
            updateBanner("bottom");
            f_ChatArea.show();
            $(".chat").removeClass("hide");
            $(".chat-resize").removeClass("hide");
            if (user.is_anonymous) {
                m_CurrentUser.display_name = ""
            }
            if (m_ChatOptions.roomCount > 1 && m_ChatOptions.userIsModOrStaff) {
                f_RoomsList.empty();
                for (var roomIndex = 0; roomIndex < m_ChatOptions.roomCount; roomIndex++) {
                    var room = m_RoomListItemTemplate({room: roomIndex + 1,roomIndex: roomIndex,current: m_ChatOptions.assignedRoom == roomIndex ? "&gt;&nbsp;" : "&nbsp;&nbsp;"});
                    f_RoomsList.append($(room))
                }
                f_RoomsListContainer.show()
            }
        });
        m_Socket.on("initialize_chat", function(options) {
            m_GlobalCooldown = options.globalThrottle;
            m_UserCooldown = options.userThrottle;
            f_GlobalThrottleTime.text(options.globalThrottle / 1e3);
            var throttle = 0;
            if (!m_CurrentUser.is_staffOrModerator && !m_CurrentUser.is_vip) {
                throttle = options.userThrottle > options.globalThrottle ? options.userThrottle : options.globalThrottle
            }
            m_ThrottleTime = throttle;
            f_MainConversation.empty();
            if (f_ModConversation) {
                f_ModConversation.empty()
            }
            if (!m_CurrentUser.is_banned) {
                var welcomeMsg;
                if (!m_CurrentUser.is_anonymous) {
                    welcomeMsg = "Welcome, " + m_CurrentUser.display_name + "!"
                } else {
                    welcomeMsg = "Welcome, anonymous chat lurker!";
                    f_ChatInput.attr("disabled", "disabled");
                    f_ConversationRepliesTab.remove()
                }
                if (m_loginMessage && m_loginMessage !== "") {
                    welcomeMsg += "<br /><br />" + m_loginMessage
                }
                var el = $(m_GeneralMessageTemplate({message: welcomeMsg}))[0];
                insertMessage(el)
            }
            f_ChatInput.val("");
            f_CharCount.text("0");
            if (typeof localStorage.nextMessageAt != "undefined") {
                var now = (new Date).getTime();
                if (localStorage.nextMessageAt > now) {
                    m_SecondsLeft = Math.ceil((localStorage.nextMessageAt - now) / 1e3);
                    if (m_SecondsLeft > 86400) {
                        m_SecondsLeft = 0;
                        localStorage.nextMessageAt = now
                    }
                }
            }
            if (m_SecondsLeft) {
                if (m_ThrottleInterval) {
                    clearInterval(m_ThrottleInterval)
                }
                m_ThrottleInterval = setInterval(throttleTimer, 1e3)
            }
        });
        m_Socket.on("initialize_messages", function(data) {
            if (!data.length) {
                data = []
            }
            for (var j = 0; j < data.length; j++) {
                var row = JSON.parse(data[j]);
                var messageUser = uncompactUser(row.user);
                insertUserMessage(messageUser, row.id, row.message, row.replyToId, row.replyToUsers, false)
            }
            if (m_CurrentUser.is_banned) {
                var error = m_ErrorItemTemplate({message: m_EntryModMessage});
                insertMessage($(error)[0])
            }
        });
        m_Socket.on("initialize_mod_messages", function(data) {
            if (!data.length) {
                data = []
            }
            for (var j = 0; j < data.length; j++) {
                var row = JSON.parse(data[j]);
                var messageUser = uncompactUser(row.user);
                insertUserMessage(messageUser, row.id, row.message, row.replyToId, row.replyToUsers, true)
            }
        });
        m_Socket.on("initialize_moderators", function(data) {
            m_ModList = [];
            f_ModList.empty();
            if (data) {
                for (var moderator in data) {
                    if (data.hasOwnProperty(moderator)) {
                        insertModerator(JSON.parse(data[moderator]))
                    }
                }
                f_ModListContainer.show()
            }
        });
        m_Socket.on("initialize_staff", function(data) {
            m_StaffList = [];
            f_StaffList.empty();
            if (data) {
                for (var staffMember in data) {
                    if (data.hasOwnProperty(staffMember)) {
                        insertStaff(JSON.parse(data[staffMember]))
                    }
                }
                f_StaffListContainer.show()
            }
        });
        m_Socket.on("user_list", function(users) {
            m_UserRecordsByUserName = {};
            var usersHtml = "";
            users.forEach(function(compactUser) {
                var user = uncompactUser(compactUser);
                m_Users.push(user);
                if (user.is_staff || user.is_moderator && !m_CurrentUser.is_staff) {
                    usersHtml += fillUserItemTemplate(user, m_UserItemNoModTemplate)
                } else {
                    usersHtml += fillUserItemTemplate(user, m_UserItemTemplate)
                }
                m_UserRecordsByUserName[user.username] = user
            });
            f_OnlineUsersList.empty().append($(usersHtml))
        });
        m_Socket.on("too_busy", function() {
            receivedEcho()
        });
        m_Socket.on("receive_message", function(data) {
            if (!m_CurrentUser) {
                return
            }
            var user = uncompactUser(data.user);
            if (typeof user === "undefined" || !user) {
                return
            }
            if (user.username === m_CurrentUser.username) {
                receivedEcho()
            }
            insertUserMessage(user, data.id, data.message, data.replyToId, data.replyToUsers, false)
        });
        m_Socket.on("receive_mod_message", function(data) {
            if (!m_CurrentUser) {
                return
            }
            var user = uncompactUser(data.user);
            if (typeof user == "undefined" || !user) {
                return
            }
            if (user.username == m_CurrentUser.username) {
                receivedEcho()
            }
            insertUserMessage(user, data.id, data.message, data.replyToId, data.replyToUsers, true)
        });
        m_Socket.on("receive_warning_message", function(data) {
            (new WarningWindow).init().show(data.message)
        });
        m_Socket.on("user_joined", function(user) {
            if (m_UserRecordsByUserName) {
                m_UserRecordsByUserName[user.username] = user;
                insertUserIntoList(user)
            }
        });
        m_Socket.on("user_left", function(user) {
            if (user.is_anonymous) {
                m_AnonymousUserCount--
            } else {
                if (m_UserRecordsByUserName) {
                    if (m_UserRecordsByUserName.hasOwnProperty(user.username)) {
                        delete m_UserRecordsByUserName[user.username]
                    }
                    f_OnlineUsersList.find(".js-userlist-user[data-username=" + user.username + "]").remove()
                }
                m_UserCount--
            }
            updateUserCount()
        });
        m_Socket.on("update_user_count", function(data) {
            m_AnonymousUserCount = data.a;
            m_UserCount = data.u;
            updateUserCount()
        });
        m_Socket.on("moderator_joined", function(user) {
            insertModerator(user)
        });
        m_Socket.on("moderator_left", function(user) {
            deleteModerator(user)
        });
        m_Socket.on("staff_joined", function(user) {
            insertStaff(user)
        });
        m_Socket.on("staff_left", function(user) {
            deleteStaff(user)
        });
        m_Socket.on("global_throttle_changed", function(data, moderator) {
            var newThrottle = parseInt(data, 10);
            insertAlertMessage("Global Cooldown changed to " + newThrottle / 1e3 + " seconds");
            if (m_ChatOptions.userIsModOrStaff) {
                insertModAlertMessage("Global Cooldown changed to " + newThrottle / 1e3 + " seconds by " + moderator)
            }
            m_GlobalCooldown = newThrottle;
            f_GlobalThrottleTime.text(newThrottle / 1e3);
            if (m_ChatOptions.userIsModOrStaff || m_CurrentUser.is_vip) {
                return
            }
            m_ThrottleTime = m_UserCooldown > m_GlobalCooldown ? m_UserCooldown : m_GlobalCooldown
        });
        m_Socket.on("mod_alert", function(alert) {
            insertModAlertMessage(alert)
        });
        m_Socket.on("forceRefresh", function() {
            location.reload()
        });
        m_Socket.on("full_reset", function() {
            websocketCallbackInterface.setConnectionAlert(gErrors.serverReset, true);
            setTimeout(function() {
                location.reload()
            }, 1e4)
        });
        m_Socket.on("you_are_on", function(server) {
            var lag = (new Date).getTime() - m_WhichServerRequestTime;
            alert("You are on " + server.server + ":" + server.port + "\n\nThe lagtime was " + lag + " milliseconds")
        });
        m_Socket.on("new_livestream", function() {
            $(".js-player-wrapper")[0].children[0].contentDocument.location.reload(true)
        });
        m_Socket.on("set_notification", function(notification) {
            switch (notification.which) {
                case "top":
                    m_TopBannerText = notification.text;
                    break;
                case "bottom":
                    m_BottomBannerText = notification.text;
                    break
            }
            updateBanner(notification.which)
        });
        m_Socket.on("mod_action", function(action) {
            var message = "You got moderated!";
            switch (action.action) {
                case "user_throttle":
                    {
                        m_UserCooldown = parseInt(action.throttle, 10);
                        m_ThrottleTime = m_UserCooldown > m_GlobalCooldown ? m_UserCooldown : m_GlobalCooldown;
                        if (m_ThrottleInterval) {
                            m_SecondsLeft = m_ThrottleTime / 1e3
                        }
                        var msg = m_UserCooldown > 3e4 ? gErrors.throttleUp : gErrors.throttleDown;
                        message = msg.replace(/%throttle%/g, "" + m_UserCooldown / 1e3).replace(/%refUrl%/g, action.refUrl)
                    }
                    break;
                case "ban":
                    {
                        message = gErrors.banned.replace(/%refUrl%/g, action.refUrl);
                        m_EntryModMessage = message;
                        $(".js-chatSpeak").hide().children().hide()
                    }
                    break;
                case "unban":
                    {
                        message = gErrors.unbanned.replace(/%refUrl%/g, action.refUrl);
                        $(".js-chatSpeak").show().children().show()
                    }
                    break
            }
            var error = m_ErrorItemTemplate({message: message});
            var el = $(error)[0];
            insertMessage(el)
        });
        m_Socket.on("message_deleted", function(data) {
            $(".js-message-container[data-message-id=" + data.message + "]").remove()
        });
        PlayerModules.forEach(function(module) {
            module.bindSocketEvents(m_Socket)
        })
    }
    function bindControls() {
        function _replyClick(event) {
            var chatPanel = $(event.srcElement).parents(".chat-panel").attr("id");
            if (chatPanel == "conversation-main") {
                m_switchMainInput(event)
            } else if (chatPanel == "conversation-replies") {
                m_switchMainInput(event)
            } else if (chatPanel == "conversation-mod") {
                m_switchModInput(event)
            }
            event.preventDefault();
            var username = $(this).attr("data-username");
            var messageId = $(this).attr("data-message-id");
            addCalloutUser(username);
            m_ReplyToMessageId = messageId;
            f_ChatInput.focus()
        }
        f_MainConversation.on("click", ".js-reply", _replyClick);
        f_ConversationReplies.on("click", ".js-reply", _replyClick);
        f_ModList.on("click", ".js-msgTo", _replyClick);
        f_StaffList.on("click", "a.js-msgTo", _replyClick);
        function _showReplyToButtonClick(conversation) {
            return function(event) {
                event.preventDefault();
                var $this = $(this);
                var panelId = $this.attr("data-panel-id");
                var panel = conversation.find("[data-reply-to-panel=" + panelId + "]");
                if ($this.attr("data-action") == "open") {
                    panel.show();
                    $this.attr("data-action", "close")
                } else {
                    panel.hide();
                    $this.attr("data-action", "open")
                }
            }
        }
        f_MainConversation.on("click", ".js-showReplyToButton", _showReplyToButtonClick(f_MainConversation));
        f_ConversationReplies.on("click", ".js-showReplyToButton", _showReplyToButtonClick(f_ConversationReplies));
        f_RoomsListContainer.on("click", "a.js-switchRoom", function(event) {
            event.preventDefault();
            var $this = $(this);
            var newRoomIndex = parseInt($this.attr("data-room"), 10);
            m_ChatOptions.chatPort = parseInt(m_ChatOptions.roomPorts[newRoomIndex], 10);
            m_ChatOptions.assignedRoom = newRoomIndex;
            m_WebSocketConnection.swapConnection(m_ChatOptions.chatHost, m_ChatOptions.chatPort, m_ChatOptions)
        });
        f_MainChatInteract.on("click", m_switchMainInput);
        f_ModChatInteract.on("click", m_switchModInput);
        f_RepliesChatInteract.on("click", _switchInput("replies"));
        f_ChatInput.on("paste", function(e) {
            var text = e.originalEvent.clipboardData.getData("text/plain"), selection = getSelectionText() || e.target.value.substring(e.target.selectionStart, e.target.selectionEnd), newLength = text.length + $(this).val().length - selection.length;
            if (newLength > m_maxMessageLength) {
                e.preventDefault()
            } else if (newLength) {
                f_CharCount.text(newLength)
            }
        });
        f_ChatForm.keyup(function(event) {
            switch (event.which) {
                case 13:
                    event.preventDefault();
                    if (!checkForUserCallout()) {
                        $(this).submit()
                    }
                    break;
                case 8:
                case 46:
                    f_CharCount.text(f_ChatInput.val().length);
                    break;
                case 37:
                case 38:
                case 39:
                case 40:
                    break;
                default:
                    var value = checkForUserCallout() || f_ChatInput.val();
                    f_CharCount.text(value.length);
                    break
            }
        });
        f_ChatForm.keydown(function(e) {
            switch (e.which) {
                case 13:
                    e.preventDefault();
                    break;
                case 8:
                case 37:
                case 38:
                case 39:
                case 40:
                case 46:
                    break;
                default:
                    var length = f_ChatInput.val().length;
                    var modifier = e.metaKey || e.ctrlKey || e.altKey;
                    if (length >= m_maxMessageLength && !modifier && getSelectionText() === "") {
                        e.preventDefault()
                    }
                    break
            }
        });
        f_ChatForm.submit(function(event) {
            event.preventDefault();
            var message = $.trim(f_ChatInput.val().replace(/\r?\n|\r/g, ""));
            if (message === "") {
                return false
            }
            if (m_SecondsLeft > 0) {
                $("#chillpill").text("Chill out...").show();
                return false
            } else {
                $("#chillpill").hide()
            }
            if (message.length > m_maxMessageLength) {
                return false
            }
            message = encodeURIComponent(message.substring(0, m_maxMessageLength));
            var replyToUsers = [];
            f_ReplyToList.find(".js-replyToUser").each(function(i, e) {
                replyToUsers.push($(e).attr("data-username").toLowerCase())
            });
            if (!replyToUsers.length) {
                m_ReplyToMessageId = 0
            }
            if (replyToUsers.length > 4) {
                replyToUsers = replyToUsers.slice(0, 4)
            }
            f_ReplyToList.empty().next(".js-chatInput").css("padding-left", m_chatSpeakInputPad);
            var sendMessageCommand = "";
            if (m_ChatTarget == "main") {
                sendMessageCommand = "send_message";
                if (m_ThrottleTime) {
                    m_SecondsLeft = Math.ceil(m_ThrottleTime / 1e3);
                    localStorage.nextMessageAt = (new Date).getTime() + m_ThrottleTime;
                    if (m_ThrottleInterval) {
                        clearInterval(m_ThrottleInterval)
                    }
                    m_ThrottleInterval = setInterval(throttleTimer, 1e3)
                }
            } else if (m_ChatTarget == "mod") {
                sendMessageCommand = "send_mod_message"
            }
            m_Socket.emit(sendMessageCommand, {message: message,replyToId: m_ReplyToMessageId,replyToUsers: replyToUsers});
            m_ReplyToMessageId = 0;
            f_ChatForm.find(".js-chatInput").focus();
            waitForEcho();
            return true
        });
        if (m_ChatOptions.userIsModOrStaff) {
            var _filterNumeric = function(event) {
                if (event.which >= 48 && event.which <= 57) {
                    return
                }
                switch (event.which) {
                    case 8:
                    case 13:
                    case 27:
                    case 37:
                    case 39:
                    case 46:
                        return
                }
                event.preventDefault()
            };
            f_FloatingModTimeout.keypress(_filterNumeric);
            f_GlobalThrottleField.keypress(_filterNumeric)
        }
        if ($("body").hasClass("user-anon")) {
            setTimeout(function() {
                $("#anon-msg").fadeOut(function() {
                    $(this).closest(".chat-panel__container").css("padding-top", 30)
                })
            }, 1e4)
        }
        function _resizer() {
            var height = m_panelMaxHeight / m_panelCount;
            if (height > m_panelMaxHeight) {
                height = m_panelMaxHeight
            }
            $(m_panels).css("height", height + "%")
        }
        function _tabClickFn(panel) {
            return function(event) {
                event.preventDefault();
                var currentTabs = f_ChatController.find(".js-chat-tabs.s-active");
                var currentPanels = $("#chat-canvas").find(".js-chat-panel.s-active");
                var currentArray = [currentTabs, currentPanels];
                var currentColl = $(currentArray).map(function() {
                    return this.toArray()
                });
                var newTab = $(this);
                var newPanel = panel;
                if ($("#f_ChatController").hasClass("s-stacked")) {
                    if (newTab.closest(".js-chat-tabs").hasClass("s-active")) {
                        m_panelCount--;
                        if (m_panelCount === 0) {
                            f_event.removeClass("s-chat")
                        }
                    } else {
                        m_panelCount++;
                        if (m_panelCount >= 1 && !f_event.hasClass("s-chat")) {
                            f_event.addClass("s-chat")
                        }
                    }
                    newTab.closest(".js-chat-tabs").toggleClass("s-active");
                    newPanel.toggleClass("s-active").find(".js-chatInput").trigger("autosize.resize");
                    $(document).trigger("toggle_chat_panel", m_panelCount)
                } else {
                    currentColl.removeClass("s-active");
                    newTab.closest(".js-chat-tabs").addClass("s-active");
                    newPanel.addClass("s-active").find(".js-chatInput").trigger("autosize.resize");
                    m_panelCount = 1
                }
                newTab.children(".js-msg-count").remove();
                _resizer();
                setTimeout(function() {
                    m_chatSpeakInput.trigger("autosize.resize")
                }, 100)
            }
        }
        m_chatToggle.on("click.chatSpeak", function() {
            var target = $(this);
            var chatSpeak = target.closest(".chat-panel").find(".chat-speak");
            if (!chatSpeak.hasClass("s-active")) {
                target.addClass("s-active");
                chatSpeak.addClass("s-active s-focus").find("#f_ChatInput").focus()
            } else {
                target.removeClass("s-active");
                chatSpeak.removeClass("s-active s-focus")
            }
        });
        function _classToggleFn(classToToggle, targetElement) {
            return function() {
                var tarEle, classTogg = classToToggle;
                if (targetElement) {
                    tarEle = targetElement
                } else {
                    tarEle = $(this)
                }
                tarEle.toggleClass(classTogg)
            }
        }
        function _toggleTabBar() {
            var $tabBar = $("#wrapper");
            $tabBar.toggleClass("s-tabs");
            $.cookie("chat_hide_tabs", !$tabBar.hasClass("s-tabs"), {expires: 365})
        }
        function _userPrefHandlerFn(targetElement, state, cookie) {
            return function() {
                var that = $(this), options = that.closest(".js-options").children();
                $.cookie(cookie, state, {expires: 365});
                if (targetElement.hasClass(state)) {
                    return true
                } else {
                    that.addClass("s-active").siblings().removeClass("s-active");
                    targetElement.addClass(state);
                    switch (state) {
                        case "s-stacked":
                            targetElement.removeClass("s-tabbed");
                            break;
                        case "s-tabbed":
                            targetElement.removeClass("s-stacked");
                            f_MainConversationTab.trigger("click", {keepChatPrefsOpen: true});
                            break;
                        case "s-compact":
                            targetElement.removeClass("s-cozy");
                            break;
                        case "s-cozy":
                            targetElement.removeClass("s-compact");
                            break
                    }
                }
            }
        }
        $(function() {
            var layout = $.cookie("chat_layout"), padding = $.cookie("chat_padding"), hideTabs = $.cookie("chat_hide_tabs") === "true";
            if (layout === "s-tabbed") {
                _userPrefHandlerFn(f_ChatController, layout, "chat_layout")();
                $("#js-chat-pref-stacked").toggleClass("s-active");
                $("#js-chat-pref-tabbed").toggleClass("s-active")
            }
            if (padding === "s-compact") {
                _userPrefHandlerFn(f_ChatController, padding, "chat_padding")();
                $("#js-chat-pref-cozy").toggleClass("s-active");
                $("#js-chat-pref-compact").toggleClass("s-active")
            }
            if (hideTabs) {
                _toggleTabBar()
            }
        });
        f_MainConversationTab.click(_tabClickFn(f_ConversationMainPanel));
        f_ModConversationTab.click(_tabClickFn(f_ConversationModPanel));
        f_ConversationRepliesTab.click(_tabClickFn(f_ConversationRepliesPanel));
        f_OnlineUsersListTab.click(_tabClickFn(f_OnlineUsersList));
        f_PollTab.click(_tabClickFn(f_PollPanel));
        f_tabToggle.on("click.chatTab", _toggleTabBar);
        f_tabPrefs.on("click.chatTab", _classToggleFn("s-active", f_tabPrefs));
        $("#chat-prefs").on("click.chatTab", function(e) {
            e.stopPropagation()
        });
        $("#js-chat-pref-stacked").on("click.chatTab", _userPrefHandlerFn(f_ChatController, "s-stacked", "chat_layout"));
        $("#js-chat-pref-tabbed").on("click.chatTab", _userPrefHandlerFn(f_ChatController, "s-tabbed", "chat_layout"));
        $("#js-chat-pref-compact").on("click.chatTab", _userPrefHandlerFn(f_ChatController, "s-compact", "chat_padding"));
        $("#js-chat-pref-cozy").on("click.chatTab", _userPrefHandlerFn(f_ChatController, "s-cozy", "chat_padding"));
        m_chatSpeakInput.on("focusout.chatSpeak", function() {
            $(this).trigger("autosize.resize").closest(".s-focus").removeClass("s-focus")
        });
        m_chatSpeakInput.on("focusin.chatSpeak", function() {
            $(this).trigger("autosize.resize").closest(".s-active").addClass("s-focus")
        });
        function _themeSwitchFn(selection) {
            return function() {
                var theme = selection, canvas = $("body");
                if (theme === f_themeCompact) {
                    if (!canvas.hasClass("s-compact")) {
                        canvas.addClass("s-compact").removeClass("s-cozy")
                    }
                }
                if (theme === f_themeCozy) {
                    if (!canvas.hasClass("s-cozy")) {
                        canvas.addClass("s-cozy").removeClass("s-compact")
                    }
                }
            }
        }
        f_themeCompact.on("click.eventHeader", _themeSwitchFn(f_themeCompact));
        f_themeCozy.on("click.eventHeader", _themeSwitchFn(f_themeCozy));
        document.onkeydown = function(e) {
            e = e || window.event;
            if (!$(":input").is(":focus")) {
                if (e.altKey && e.keyCode === 81) {
                    f_MainConversationTab.click()
                }
                if (e.altKey && e.keyCode === 87) {
                    f_ConversationRepliesTab.click()
                }
                if (e.altKey && e.keyCode === 69) {
                    f_ModConversationTab.click()
                }
                if (e.altKey && e.keyCode === 83) {
                    f_tabToggle.click()
                }
            }
        };
        $("#onPopout").click(function(event) {
            event.preventDefault();
            f_History.addClass("hide");
            $(".chat").addClass("hide");
            $(".chat-resize").addClass("hide");
            $(".player").css("width", "100%");
            $(".spartan-resize").trigger("remove");
            m_Socket.disconnect();
            delete m_Socket;
            m_Socket = null;
            var height = $(window).height();
            $("header").hide();
            var url = "popout" + window.location.search;
            m_Popoutwindow = window.open(url, "PhoenixLiveStreamPopout", "width=500, height=" + height + ", location=no, menubar=no")
        });
        var urlMaster = new UrlMaster;
        urlMaster.bindHashChange(function() {
            var params = urlMaster.getHashParams();
            if (params.hasOwnProperty("newstuff")) {
                $(".xperimental").show()
            } else {
                $(".xperimental").hide()
            }
        }, true);
        if (m_ChatOptions.userIsModOrStaff) {
            var _moderate = function(e) {
                var username = this.getAttribute("data-username");
                f_ModerationModUser.val(username);
                f_ModUsernameDisplay.text(username);
                f_ModerationWarningMessage.val("");
                if (m_WatchedUsers.indexOf(username) != -1) {
                    f_FloatingModWatch.hide();
                    f_FloatingModUnwatch.show()
                } else {
                    f_FloatingModWatch.show();
                    f_FloatingModUnwatch.hide()
                }
                m_ModPopover.show(e);
                e.stopPropagation()
            };
            f_MainConversation.on("click", ".js-moderate", _moderate);
            f_ConversationReplies.on("click", ".js-moderate", _moderate);
            var _deleteMessage = function(e) {
                var $this = $(this);
                m_Socket.emit("delete_message", {message: $this.data("message-id"),moderator: m_CurrentUser.username,username: $this.data("username"),body: $this.siblings(".js-msg").text()})
            };
            f_MainConversation.on("click", ".js-delete-message", _deleteMessage);
            f_ConversationReplies.on("click", ".js-delete-message", _deleteMessage);
            $("#floatingMod-ban").click(function() {
                m_Socket.emit("ban", {username: f_ModerationModUser.val(),moderator: m_CurrentUser.username,duration: 1440});
                m_ModPopover.hide()
            });
            $("#floatingMod-unban").click(function() {
                m_Socket.emit("unban", {username: f_ModerationModUser.val(),moderator: m_CurrentUser.username});
                m_ModPopover.hide()
            });
            $("#floatingMod-set-timeout").click(function(event) {
                event.preventDefault();
                m_ModPopover.hide();
                var username = f_ModerationModUser.val();
                var timeout = parseInt(f_FloatingModTimeout.val(), 10) * 1e3;
                if (isNaN(timeout)) {
                    return
                }
                m_Socket.emit("set_user_throttle", {username: username,moderator: m_CurrentUser.username,throttle: timeout});
                f_ModerationModUser.val("");
                f_FloatingModTimeout.val("")
            });
            $("#floatingMod-send-warning-msg").click(function(event) {
                event.preventDefault();
                m_Socket.emit("send_warning_message", {username: f_ModerationModUser.val(),moderator: m_CurrentUser.username,message: f_ModerationWarningMessage.val()});
                m_ModPopover.hide()
            });
            f_FloatingModWatch.click(function(event) {
                event.preventDefault();
                var user = f_ModerationModUser.val();
                if (m_WatchedUsers.indexOf(user) != -1) {
                    return
                }
                m_WatchedUsers.push(user);
                f_MainConversation.children(".js-message-container[data-username=" + user + "]").each(function(i, e) {
                    $(e).css({border: "3px solid pink"})
                });
                m_ModPopover.hide()
            });
            f_FloatingModUnwatch.click(function(event) {
                event.preventDefault();
                var user = f_ModerationModUser.val();
                var index = m_WatchedUsers.indexOf(user);
                if (index == -1) {
                    return
                }
                m_WatchedUsers.splice(index, 1);
                f_MainConversation.children(".js-message-container[data-username=" + user + "]").each(function(i, e) {
                    $(e).css({border: "none"})
                });
                m_ModPopover.hide()
            });
            $("#floatingMod-cancel").click(function(event) {
                event.preventDefault();
                m_ModPopover.hide()
            });
            $("#f_SetGlobalThrottle").click(function(event) {
                event.preventDefault();
                var throttle = parseInt(f_GlobalThrottleField.val(), 10) * 1e3;
                if (isNaN(throttle)) {
                    return
                }
                if (throttle === 69e3) {
                    alert("Grow up! (ノಠ ∩ಠ)ノ彡( \\o°o)\\");
                    return
                }
                m_Socket.emit("set_global_throttle", {throttle: throttle,moderator: m_CurrentUser.username});
                f_GlobalThrottleField.val("")
            });
            $("#f_WhichServerButton").click(function() {
                m_WhichServerRequestTime = (new Date).getTime();
                m_Socket.emit("which_server")
            });
            $("#f_SetTopBanner").click(function() {
                m_Socket.emit("edit_notification", {which: "top",value: f_TopBannerInput.val()})
            });
            $("#f_ResetTopBanner").click(function() {
                f_TopBannerInput.empty().append(m_TopBannerText)
            });
            $("#f_SetBottomBanner").click(function() {
                m_Socket.emit("edit_notification", {which: "bottom",value: f_BottomBannerInput.val()})
            });
            $("#f_ResetBottomBanner").click(function() {
                f_BottomBannerInput.empty().append(m_BottomBannerText)
            });
            $("#f_RefreshStreams").click(function() {
                m_Socket.emit("refresh_streams")
            })
        }
    }
    function waitForEcho() {
        f_ChatInput.prop("disabled", true);
        m_MessageEchoTimeout = setTimeout(receivedEcho, 1e4)
    }
    function receivedEcho() {
        f_ChatInput.val("");
        f_CharCount.text("0");
        f_ChatInput.prop("disabled", false).trigger("autosize.resize");
        clearTimeout(m_MessageEchoTimeout);
        m_MessageEchoTimeout = null
    }
    function updateUserCount() {
        if ($("#f_UserStats").is(":hidden")) {
            $("#f_UserStats").show()
        }
        if ($("#f_AnonymousStats").is(":hidden") && StreamOptions.anonymousAllowed) {
            $("#f_AnonymousStats").show()
        }
        f_UserCount.text(m_UserCount);
        f_AnonymousUserCount.text(m_AnonymousUserCount || 0)
    }
    function checkForUserCallout() {
        var value = f_ChatInput.val();
        var found = [];
        var workingBuffer = value;
        for (var nextIndex = value.indexOf("@"); nextIndex != -1; nextIndex = workingBuffer.indexOf("@")) {
            workingBuffer = workingBuffer.substr(nextIndex);
            var nextSpace = workingBuffer.indexOf(" ");
            if (nextSpace == -1) {
                nextSpace = workingBuffer.indexOf("\n");
                if (nextSpace == -1) {
                    break
                }
            }
            if (nextSpace == 1) {
                workingBuffer = workingBuffer.substr(2, workingBuffer.length);
                continue
            }
            var toUser = workingBuffer.substr(1, nextSpace - 1);
            addCalloutUser(toUser);
            found.push("@" + workingBuffer.substr(1, nextSpace));
            workingBuffer = workingBuffer.substr(nextSpace, workingBuffer.length)
        }
        found.forEach(function(e) {
            value = value.replace(new RegExp(e, "g"), "")
        });
        f_ChatInput.val(value);
        f_ChatInput.focus();
        return found.length ? value : null
    }
    function addCalloutUser(username) {
        var replyToElement = m_ReplyToItemTemplate({username: username});
        var replyToListWidth = 0;
        replyToElement = $(replyToElement);
        f_ReplyToList.show().append(replyToElement);
        f_ReplyToList.next(m_chatSpeakInput).focus(function() {
            replyToListWidth = f_ReplyToList.outerWidth();
            $(this).css("padding-left", replyToListWidth + parseInt(m_chatSpeakInputPad))
        });
        var deleteButton = replyToElement.find(".js-deleteReplyTo");
        deleteButton.click(function(e) {
            e.preventDefault();
            var listItem = $(this).closest("li"), listItemWidth = listItem.outerWidth(), container = listItem.parent().next(m_chatSpeakInput);
            listItem.remove();
            if (listItemWidth >= replyToListWidth) {
                container.removeAttr("style")
            } else {
                container.css("padding-left", m_chatSpeakInputPad)
            }
        })
    }
    function insertUserMessage(user, messageId, message, replyToId, replyToUsers, modMessage) {
        if (typeof modMessage == "undefined") {
            modMessage = false
        }
        if (typeof replyToUsers == "undefined") {
            replyToUsers = []
        }
        message = $("<div/>").text(decodeURIComponent(message)).html();
        message = convertLinksAndEmoticons(user, message);
        var originalMessage = null;
        var isReply = typeof replyToId != "undefined";
        if (isReply) {
			//WC: find OG message
            originalMessage = f_MainConversation.find(".js-message-container[data-message-id=" + replyToId + "]");
            if (!originalMessage.length) {
                isReply = false
            }
        }
        var context = getUserAttributes(user);
        var lwrUserName = m_CurrentUser.display_name.toLowerCase();
        var replyToUsersList = "";
        replyToUsers.forEach(function(e) {
            replyToUsersList += e + ", "
        });
        replyToUsersList = replyToUsersList.replace(/(^\s*,)|(,\s*$)/g, "");
        context.message = message;
        context.messageId = messageId.toString(16);
        context.replyToUsersList = replyToUsersList;
        context.toUsersDisplay = replyToUsersList === "" ? "none" : "inline";
        var template = m_ChatItemTemplate;
        if (isReply) {
            template = m_ReplyToChatItemTemplate;
            var originalAvatar = originalMessage.find(".js-avatar");
            context.replyToDisplayName = originalMessage.find(".js-user").html();
            context.replyToProfileUrl = originalAvatar.attr("href");
            context.replyToAvatar = originalAvatar.find("img").attr("src");
            context.replyToMessage = originalMessage.find(".js-msg").html()
        }
        var element = $(template(context));
        if (m_WatchedUsers.indexOf(user.username) != -1) {
            element.css({border: "3px solid pink"})
        }
        if (modMessage || user.username == m_CurrentUser.username) {
            element.find(".js-moderate").remove();
            element.find(".js-reply").remove()
        } else if (user.is_staff || user.is_moderator && !m_CurrentUser.is_staff) {
            element.find(".js-moderate").remove()
        }
        var messageDiv = element[0];
        if (replyToUsers.indexOf(lwrUserName) != -1) {
            var $replyDiv = element.clone();
            $replyDiv.find(".js-replyToMsg").show();
            $replyDiv.find(".showReplyToButton").attr("data-action", "close").text("-");
            missedMessages(f_ConversationRepliesTab, f_ConversationRepliesPanel);
            f_ConversationReplies.prepend($replyDiv);
            if ($("#conversation-replies").hasClass("s-active")) {
                scrollHoldFn($replyDiv, "#conversation-replies")
            }
            if (element.hasClass("js-message-container")) {
                element.addClass("mentioned")
            } else {
                element.find(".js-message-container").addClass("mentioned")
            }
        }
        if (modMessage) {
            insertModMessage(messageDiv)
        } else {
            insertMessage(messageDiv)
        }
    }
    function insertUserIntoList(user) {
        var i;
        var numUsers = m_Users.length;
        var previousElement = null;
        if (numUsers < 5) {
            for (i = 0; i < numUsers; i++) {
                if (user.username > m_Users[i].username) {
                    if (i + 1 != numUsers && user.username <= m_Users[i + 1].username) {
                        previousElement = f_OnlineUsersList.find(".js-userlist-user[data-username=" + m_Users[i].username + "]");
                        m_Users.splice(i + 1, 0, user);
                        break
                    }
                }
            }
            if (i == numUsers) {
                m_Users.push(user)
            }
        } else {
            var _insert = function(range) {
                var distance = range[1] - range[0];
                if (distance > 1) {
                    var middle = Math.floor(range[0] + distance / 2);
                    if (middle < 1) {
                        return range[0]
                    } else {
                        if (user.username > m_Users[middle].username) {
                            return _insert([middle, range[1]])
                        } else {
                            return _insert([range[0], middle])
                        }
                    }
                } else {
                    if (!distance) {
                        return range[0]
                    } else {
                        if (user.username < m_Users[range[1]].username) {
                            return range[0]
                        } else {
                            return range[1]
                        }
                    }
                }
            };
            var insertAt = _insert([0, numUsers - 1]);
            previousElement = f_OnlineUsersList.find(".js-userlist-user[data-username=" + m_Users[insertAt].username + "]");
            if (!insertAt) {
                m_Users.unshift(user)
            } else {
                m_Users.splice(insertAt + 1, 0, user)
            }
        }
        var element = getUserAttributes(user);
        element = $(element);
        if (user.is_staff) {
            element.find(".js-moderate").remove()
        } else if (user.is_moderator && !m_CurrentUser.is_staff) {
            element.find(".js-moderate").remove()
        }
        if (previousElement && previousElement[0]) {
            element.insertAfter(previousElement)
        } else {
            f_OnlineUsersList.prepend(element)
        }
    }
    function convertLinks(html) {
        var matches = URL_REGEX.exec(html);
        if (matches && matches.length > 2) {
            var string = matches[0];
            var addFront = false;
            if (string.indexOf("www.") === 0) {
                addFront = true
            }
            html = html.replace(URL_REGEX, '<a class="auto-link injected" href="' + (addFront ? "http://" : "") + '$&" target="_blank">$&</a>')
        }
        return html
    }
    function convertLinksAndEmoticons(user, spanMessage) {
        var skipLinkCheck = false;
        if (user.is_staff) {
            var imgs = spanMessage.match(/\^\b[a-z\./0-9\-\_]+/g);
            if (imgs) {
                skipLinkCheck = true;
                imgs.forEach(function(match) {
                    var url = match.substring(1);
                    var isUrl = url.match(URL_REGEX);
                    if (isUrl) {
                        spanMessage = spanMessage.replace(match, '<img class="you-cant-touch-this" src="http://' + url + '">')
                    }
                })
            }
        }
        if (!skipLinkCheck) {
            var matches = URL_REGEX.exec(spanMessage);
            if (matches && matches.length > 2) {
                var string = matches[0];
                var addFront = false;
                if (string.indexOf("www.") === 0) {
                    addFront = true
                }
                spanMessage = spanMessage.replace(URL_REGEX, '<a class="auto-link injected" href="' + (addFront ? "http://" : "") + '$&" target="_blank">$&</a>')
            }
        }
        var emoteRegex = /:\b[a-z]+/g;
        var emoteTokens = spanMessage.match(emoteRegex);
        var canEmote = user.is_staffOrModerator || user.is_subscriber_yearly || user.is_subscriber_monthly || user.is_vip;
        var canSkipLimit = user.is_staffOrModerator || user.is_vip;
        var emoteCount = 0;
        var usedEmotes = [];
        if (!canEmote || !emoteTokens || emoteTokens.length < 1) {
            return spanMessage
        }
        $.each(emoteTokens, function(index, match) {
            if (emoteCount >= 5 && !canSkipLimit)
                return;
            var token = match.substring(1);
            var emote = m_Emoticons[token];
            if (emote && canEmote && (usedEmotes.indexOf(token) === -1 || canSkipLimit)) {
                spanMessage = spanMessage.replace(match, '<img src="' + emote + '">');
                emoteCount += 1;
                usedEmotes.push(token)
            }
        });
        return spanMessage
    }
    function getUserAttributes(user) {
        var itemClass = "";
        if (user.is_staff) {
            itemClass = "staff"
        } else if (user.is_moderator) {
            itemClass = "mod"
        } else if (user.is_vip) {
            itemClass = "vip"
        }
        var avatarClass = "avatar";
        if (user.is_subscriber_yearly) {
            avatarClass += " subscriber yearly"
        } else if (user.is_subscriber_monthly) {
            avatarClass += " subscriber monthly"
        }
        if (StreamOptions.disableAvatars) {
            avatarClass += " hide"
        }
        var specialStyle = "";
        return {itemClass: itemClass,specialStyle: specialStyle,displayName: user.display_name,userName: user.username,avatar: user.image_url,avatarClass: avatarClass,profileUrl: user.profile_url,isModOrStaff: m_ChatOptions.userIsModOrStaff}
    }
    function missedMessages(target, watch) {
        var panel = watch;
        if (!panel.hasClass("s-active")) {
            var replyLink = target, countSpan = replyLink.find(".js-msg-count");
            if (!countSpan.length) {
                countSpan = $('<span class="js-msg-count chat-tabs__count">1</span>');
                replyLink.append(countSpan)
            } else {
                var curCount = countSpan.text();
                var newCount = parseInt(curCount, 10) + 1;
                countSpan.text(newCount)
            }
        }
    }
    function scrollHoldFn(element, target) {
        var messageHeight = $(element).outerHeight() + 1;
        var scrollWrap = $(target).find(".chat-scroll-hold");
        var curScrollTop = scrollWrap.scrollTop();
        if (curScrollTop > 0) {
            scrollWrap.scrollTop(curScrollTop + messageHeight)
        }
    }
    function insertMessage(element) {
        f_MainConversation.prepend(element);
        if (f_MainConversation.children().length > 150) {
            f_MainConversation.children().last().remove()
        }
        if ($("#conversation-main").hasClass("s-active")) {
            scrollHoldFn(element, "#conversation-main")
        }
        missedMessages(f_MainConversationTab, f_ConversationMainPanel);
        $(element).find("img").on("error", function() {
            $(this).attr("src", m_DefaultAvatarPath)
        })
    }
    function insertModMessage(element) {
        if (!f_ModConversation) {
            return
        }
        f_ModConversation.prepend(element);
        if ($("#conversation-mod").hasClass("s-active")) {
            scrollHoldFn(element, "#conversation-mod")
        }
        missedMessages(f_ModConversationTab, f_ConversationModPanel);
        if (f_ModConversation.children().length > 150) {
            f_ModConversation.children().last().remove()
        }
    }
    function throttleTimer() {
        f_ThrottleTime.text(--m_SecondsLeft);
        if (m_SecondsLeft <= 0) {
            clearInterval(m_ThrottleInterval);
            m_ThrottleInterval = null;
            localStorage.nextMessageAt = 0;
            $("#chillpill").hide()
        }
    }
    function insertStaff(user) {
        if (m_StaffList.indexOf(user.username) != -1) {
            return
        }
        if (!m_StaffList.length) {
            f_StaffListContainer.show()
        }
        m_StaffList.push(user.username);
        var item = m_ModListItemTemplate({userName: user.username,displayName: user.display_name ? user.display_name : user.username});
        f_StaffList.append(item)
    }
    function deleteStaff(user) {
        var index = m_StaffList.indexOf(user.username);
        if (index == -1) {
            return
        }
        m_StaffList.splice(index, 1);
        if (!m_StaffList.length) {
            f_StaffListContainer.hide()
        }
        var userElement = $("#modstaff-" + user.username);
        userElement.remove()
    }
    function insertModerator(user) {
        if (m_ModList.indexOf(user.username) != -1) {
            return
        }
        if (!m_ModList.length) {
            f_ModListContainer.show()
        }
        m_ModList.push(user.username);
        var item = m_ModListItemTemplate({userName: user.username,displayName: user.display_name ? user.display_name : user.username});
        f_ModList.append(item)
    }
    function deleteModerator(user) {
        var index = m_ModList.indexOf(user.username);
        if (index == -1) {
            return
        }
        m_ModList.splice(index, 1);
        if (!m_ModList.length) {
            f_ModListContainer.hide()
        }
        var userElement = $("#modstaff-" + user.username);
        userElement.remove()
    }
    function insertAlertMessage(msg) {
        insertMessage($(m_NoticeTemplate({message: msg})))
    }
    function insertModAlertMessage(msg) {
        insertModMessage($(m_NoticeTemplate({message: msg})))
    }
    function _removeBannerFn(target) {
        return function() {
            target.fadeOut()
        }
    }
    function updateBanner(which) {
        var bannerSwitch = {top: function() {
                var banner = $("#importantBanner");
                var remove = banner.find(".js-remove");
                banner.find(".js-chat-banner-msg").text(m_TopBannerText);
                banner.css("display", m_TopBannerText !== "" ? "block" : "none");
                if (f_TopBannerInput) {
                    f_TopBannerInput.val(m_TopBannerText)
                }
                remove.on("click.banner", _removeBannerFn(banner))
            },bottom: function() {
                var banner = $(".js-chat-banner");
                var remove = banner.find(".js-remove");
                banner.find(".js-chat-banner-msg").text(m_BottomBannerText);
                banner.css("display", m_BottomBannerText !== "" ? "block" : "none");
                if (f_BottomBannerInput) {
                    f_BottomBannerInput.val(m_BottomBannerText)
                }
                remove.on("click.banner", _removeBannerFn(banner))
            }};
        if (bannerSwitch.hasOwnProperty(which) && typeof bannerSwitch[which] === "function") {
            bannerSwitch[which]()
        }
    }
    function _switchInput(chatbox) {
        return function(event) {
            event.preventDefault();
            if (m_activePanel == chatbox) {
                return
            }
            if (chatbox === "main") {
                $(".main_chat-speak__interact .js-chat-text-input").remove();
                f_MainChatInteract.append($("#chat-form"));
                $(".js-chat-text-input").clone().first().appendTo("." + m_activePanel + "_chat-speak__interact")
            } else if (chatbox === "replies") {
                $(".replies_chat-speak__interact .js-chat-text-input").remove();
                f_RepliesChatInteract.append($("#chat-form"));
                $(".js-chat-text-input").clone().first().appendTo("." + m_activePanel + "_chat-speak__interact")
            } else if (chatbox === "mod") {
                $(".mod_chat-speak__interact .js-chat-text-input").remove();
                f_ModChatInteract.append($("#chat-form"));
                $(".js-chat-text-input").clone().first().appendTo("." + m_activePanel + "_chat-speak__interact")
            }
            f_ChatInput.focus();
            m_ChatTarget = chatbox;
            m_activePanel = chatbox
        }
    }
    var f_UserCount = null;
    var f_AnonymousUserCount = null;
    var f_CharCount = null;
    var f_WaitForThrottleMsg = null;
    var f_ChatInput = null;
    var f_MainInput = null;
    var f_RepliesInput = null;
    var f_FriendsInput = null;
    var f_ReplyToList = null;
    var f_MainConversation = null;
    var f_ModConversation = null;
    var f_ConversationReplies = null;
    var f_OnlineUsersList = null;
    var f_ChatController = null;
    var f_ChatArea = null;
    var f_ChatForm = null;
    var f_History = null;
    var f_Alert = null;
    var f_MainChatInteract = null;
    var f_ModChatInteract = null;
    var f_RepliesChatInteract = null;
    var f_FriendsChatInteract = null;
    var f_chatCountMax = null;
    var m_activePanel = null;
    var m_panelCount = null;
    var m_panels = null;
    var m_panelMaxHeight = null;
    var m_panelParent = null;
    var m_chatToggle = null;
    var m_chatSpeak = null;
    var m_chatSpeakInput = null;
    var m_chatSpeakInputPad = null;
    var f_FloatingMod = null;
    var f_FloatingModTimeout = null;
    var f_FloatingModWatch = null;
    var f_FloatingModUnwatch = null;
    var f_GlobalThrottleField = null;
    var f_ModerationModUser = null;
    var f_ModUsernameDisplay = null;
    var f_ModerationWarningMessage = null;
    var f_WarningBox = null;
    var f_StaffListContainer = null;
    var f_StaffList = null;
    var f_ModListContainer = null;
    var f_ModList = null;
    var f_RoomsListContainer = null;
    var f_RoomsList = null;
    var f_ThrottleTime = null;
    var f_GlobalThrottleTime = null;
    var f_TopBannerInput = null;
    var f_BottomBannerInput = null;
    var f_MainConversationTab = null;
    var f_ModConversationTab = null;
    var f_ConversationRepliesTab = null;
    var f_PollTab = null;
    var f_OnlineUsersListTab = null;
    var f_tabToggle = null;
    var f_tabPrefs = null;
    var f_tabToggleParent = null;
    var f_event = null;
    var f_themeCompact = null;
    var f_themeCozy = null;
    var f_ConversationMainPanel = null;
    var f_ConversationModPanel = null;
    var f_ConversationRepliesPanel = null;
    var f_ConversationFollowsPanel = null;
    var f_PollPanel = null;
    var m_ChatOptions = null;
    var m_WebSocketConnection = null;
    var m_Socket = null;
    var m_ModPopover = null;
    var m_CurrentUser = null;
    var m_UserCount = 0;
    var m_AnonymousUserCount = 0;
    var m_EntryModMessage = "";
    var m_ThrottleTime = 0;
    var m_Users = [];
    var m_UserRecordsByUserName = null;
    var m_SecondsLeft = 0;
    var m_ThrottleInterval = null;
    var m_GlobalCooldown = null;
    var m_UserCooldown = null;
    var m_WatchedUsers = [];
    var m_Popoutwindow = null;
    var m_StaffList = [];
    var m_ModList = [];
    var m_ReplyToMessageId = 0;
    var m_ChatTarget = "main";
    var m_WhichServerRequestTime = 0;
    var m_TopBannerText = "";
    var m_BottomBannerText = "";
    var m_MessageEchoTimeout = null;
    var m_CurrentConnectionAlertMessageCode = "";
    var m_ConnectionAlertAnimationInterval = null;
    var m_ConnectionAlertAnimationFrames = 0;
    var m_ChatItemTemplate = null;
    var m_ReplyToChatItemTemplate = null;
    var m_ErrorItemTemplate = null;
    var m_MessageItemTemplate = null;
    var m_GeneralMessageTemplate = null;
    var m_NoticeTemplate = null;
    var m_ModListItemTemplate = null;
    var m_RoomListItemTemplate = null;
    var m_UserItemTemplate = null;
    var m_UserItemNoModTemplate = null;
    var m_ReplyToItemTemplate = null;
    var m_Emoticons = [];
    var m_switchMainInput = null;
    var m_switchModInput = null;
    var m_maxMessageLength = 0;
    return exports
};
$(document).ready(function() {
    var $documentReference = $(document);
    var $documentBody = $(document.body);
    var $chatController = $("#f_ChatController");
    var browserHasChatSupport = onSupportedBrowser();
    if (typeof Storage === "undefined") {
        alert("The '90s called. It wants its browser back.\n\nSorry, your browser is way too old for chat.");
        return
    }
    if (!browserHasChatSupport) {
        $("#f_OldBrowser").show().siblings().remove();
        return
    } else {
        $("#f_OldBrowser").remove()
    }
    var urlMaster = new UrlMaster;
    var params = urlMaster.getAllParams();
    params.id = StreamOptions.chatId;
    var chat = new Chat;
    AjaxApiRequest.makeGetApiRequest("/chat/chatInit", params, function(result) {
        if (result.result == "ok") {
            unstringifyBooleans(result.chatOptions);
            var noWait = urlMaster.getParam("noWait");
            if (noWait) {
                result.chatOptions.noWait = true
            }
            chat.initialize(result.chatOptions, function(err) {
                if (!err) {
                    chat.connect()
                } else {
                    _error()
                }
            })
        } else {
            console.error(result.exception);
            _error()
        }
    }, _error);
    function _error() {
        chat.error(gErrors.badConfig)
    }
    if (StreamOptions.playerType === "twitch") {
        function _updateViewerCount() {
            ChatPlayerExtensions.viewerCount($(".spartan-stats__watching .spartan-stats__count"))
        }
        _updateViewerCount();
        setInterval(_updateViewerCount, 2e4)
    } else {
        $(".spartan-stats__watching").hide()
    }
    if (window.location.href.indexOf("popout") >= 0) {
        $(".spartan-tools").hide()
    }
    var $splitter, $wrapperContainer = $(".wrapper-container"), splitMousedownClass = "is-split-mousedown", splitMouseupEvent = "mouseup.chatClientSplitter", splitterZIndexKey = "original-z-index", onSplitMouseStart = function() {
        $wrapperContainer.addClass(splitMousedownClass);
        $documentReference.on(splitMouseupEvent, onSplitMouseEnd);
        toggleSplitterZIndex()
    }, onSplitMouseEnd = function() {
        $wrapperContainer.removeClass(splitMousedownClass);
        $documentReference.off(splitMouseupEvent, onSplitMouseEnd);
        toggleSplitterZIndex(true)
    };
    var toggleSplitterZIndex = function(toLower) {
        if (!$splitter) {
            return
        }
        if (!$splitter.data(splitterZIndexKey)) {
            $splitter.data(splitterZIndexKey, $splitter.css("z-index"))
        }
        if (toLower) {
            $splitter.css("z-index", 1)
        } else {
            $splitter.css("z-index", $splitter.data(splitterZIndexKey))
        }
    };
    if (!($documentBody.hasClass("popout") || $documentBody.data("no-splitter"))) {
        $wrapperContainer.splitter({splitbarClass: "spartan-resize",resizeToWidth: true,anchorToWindow: true,sizeRight: true,cookie: "gb-chat-slider",outline: true});
        $splitter = $(".spartan-resize");
        toggleSplitterZIndex(true);
        $splitter.on("mousedown.chatClientSplitter", onSplitMouseStart)
    }
    $documentReference.on("ad_rendered", function() {
        if ($("body").hasClass("skin-yes")) {
            if ($splitter && $splitter.length > 0) {
                $splitter.data("removed", true);
                $splitter.remove()
            }
            $(".chat").attr("style", "");
            $(".player").attr("style", "");
            if ($("#f_ChatController").hasClass("s-stacked")) {
                $("#f_ChatController").removeClass("s-stacked").addClass("s-tabbed s-compact")
            }
        }
        $(window).trigger("resize");
        $("#wrapper").css("top", $("#leader_top-wrap").outerHeight())
    });
    function checkMultiplePlayers() {
        var $wrapper = $(".js-player-wrapper");
        var $body = $wrapper.find("iframe").contents().find("body");
        if ($body.hasClass("body-multiplayers")) {
            $wrapper.addClass("player-wrapper--double")
        } else {
            $wrapper.removeClass("player-wrapper--double")
        }
    }
    $documentReference.on("iframeLoaded", checkMultiplePlayers);
    $(".js-chatInput").autosize({append: false});
    if (browserHasChatSupport) {
        var chatPanelChecker = function() {
            var $localDocBody = $documentBody, splitterRemoved = false, noChatPanelsClass = "no-chat-panels", hasChatPanels = true, hasChatPanelStateChange = false;
            var toggleSplitter = function(enabled) {
                var $localSplitterRef = $splitter, $splitterPrevSibling, detached;
                if (!$localSplitterRef || $localSplitterRef.data("removed")) {
                    splitterRemoved = true;
                    return
                }
                detached = $localSplitterRef.data("detached") || false;
                if (detached) {
                    $splitterPrevSibling = $localSplitterRef.data("previousSibling")
                }
                if (enabled && detached) {
                    $localSplitterRef.insertAfter($splitterPrevSibling);
                    $localSplitterRef.data("detached", false)
                } else if (!enabled && !detached) {
                    $localSplitterRef.data("previousSibling", $localSplitterRef.prev());
                    $localSplitterRef.data("detached", true);
                    $localSplitterRef.detach()
                }
            };
            return function(e, panelCount) {
                if (panelCount > 0 && hasChatPanels === false) {
                    hasChatPanels = true;
                    hasChatPanelStateChange = true
                } else if (panelCount < 1 && hasChatPanels === true) {
                    hasChatPanels = false;
                    hasChatPanelStateChange = true
                }
                if (hasChatPanelStateChange) {
                    if (hasChatPanels) {
                        $localDocBody.removeClass(noChatPanelsClass);
                        toggleSplitter(true)
                    } else {
                        $localDocBody.addClass(noChatPanelsClass);
                        toggleSplitter(false)
                    }
                }
            }
        }();
        $documentReference.on("toggle_chat_panel", chatPanelChecker)
    }
    var $chatPrefsToggle = $("#js-chat-tabs-prefs");
    var chatPrefsChecker = function() {
        var $chatPrefs = $("#chat-prefs"), $chat = $("#js-spartan"), chatPrefsOpenKey = "open", chatPrefsCheckerClickEvent = "click.chatPrefs", isChatPrefsOpenClass = "is-chat-prefs-open";
        $chatPrefs.data(chatPrefsOpenKey, false);
        var checkExternalClickHandler = function(e, data) {
            if ($chatPrefs.data(chatPrefsOpenKey)) {
                var $clicked = $(e.target), isExternalClick = true;
                if ($clicked.closest($chatPrefs).length > 0 || $clicked.closest($chatPrefsToggle).length > 0 || (data || {}).keepChatPrefsOpen) {
                    isExternalClick = false;
                    e.stopPropagation()
                }
                if (isExternalClick) {
                    $chatPrefsToggle.trigger("click.chatTab");
                    $chat.off(chatPrefsCheckerClickEvent)
                }
            }
        };
        return function() {
            if (!$chatPrefs.data(chatPrefsOpenKey)) {
                $chatPrefs.data(chatPrefsOpenKey, true);
                $chat.on(chatPrefsCheckerClickEvent, checkExternalClickHandler);
                $wrapperContainer.addClass(isChatPrefsOpenClass)
            } else {
                $chatPrefs.data(chatPrefsOpenKey, false);
                $chat.off(chatPrefsCheckerClickEvent);
                $wrapperContainer.removeClass(isChatPrefsOpenClass)
            }
        }
    }();
    $chatPrefsToggle.on("click.chatTab", chatPrefsChecker)
});
