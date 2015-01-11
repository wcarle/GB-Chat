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