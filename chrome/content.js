//Get extension settings.
//Check if Firefox or not.
const isFirefox = !chrome.app;

function updateSettings() {
    if (isFirefox) {
        var hideBlockingMessage = browser.storage.sync.get('blockingMessageTTV');
        hideBlockingMessage.then((res) => {
            if (res.blockingMessageTTV == "true" || res.blockingMessageTTV == "false") {
                window.postMessage({
                    type: "SetHideBlockingMessage",
                    value: res.blockingMessageTTV
                }, "*");
            }
        });
    } else {
        chrome.storage.local.get(['blockingMessageTTV'], function(result) {
            if (result.blockingMessageTTV == "true" || result.blockingMessageTTV == "false") {
                window.postMessage({
                    type: "SetHideBlockingMessage",
                    value: result.blockingMessageTTV
                }, "*");
            }
        });
    }
}

function removeVideoAds() {
    //This stops Twitch from pausing the player when in another tab and an ad shows.
    try {
        Object.defineProperty(document, 'visibilityState', {
            get() {
                return 'visible';
            }
        });
        Object.defineProperty(document, 'hidden', {
            get() {
                return false;
            }
        });
        const block = e => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        document.addEventListener('visibilitychange', block, true);
        document.addEventListener('webkitvisibilitychange', block, true);
        document.addEventListener('mozvisibilitychange', block, true);
        document.addEventListener('hasFocus', block, true);
        if (/Firefox/.test(navigator.userAgent)) {
            Object.defineProperty(document, 'mozHidden', {
                get() {
                    return false;
                }
            });
        } else {
            Object.defineProperty(document, 'webkitHidden', {
                get() {
                    return false;
                }
            });
        }
    } catch (err) {}

    //Send settings updates to worker.
    window.addEventListener("message", (event) => {
        if (event.source != window)
            return;
        if (event.data.type && (event.data.type == "SetHideBlockingMessage")) {
            if (twitchMainWorker) {
                twitchMainWorker.postMessage({
                    key: 'SetHideBlockingMessage',
                    value: event.data.value
                });
            }
        }
    }, false);

    function declareOptions(scope) {
        scope.AdSignifier = 'stitched';
        scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        scope.ClientVersion = 'null';
        scope.PlayerType1 = 'site'; //Source
        scope.PlayerType2 = 'thunderdome'; //480p
        scope.PlayerType3 = 'pop_tart'; //480p
        scope.PlayerType4 = 'picture-by-picture'; //360p
        scope.CurrentChannelName = null;
        scope.UsherParams = null;
        scope.WasShowingAd = false;
        scope.GQLDeviceID = null;
        scope.HideBlockingMessage = false;
        scope.CurrentVideoPlayerQuality = null;
    }

    declareOptions(window);

    var twitchMainWorker = null;

    var adBlockDiv = null;

    const oldWorker = window.Worker;

    window.Worker = class Worker extends oldWorker {
        constructor(twitchBlobUrl) {
            if (twitchMainWorker) {
                super(twitchBlobUrl);
                return;
            }
            var jsURL = getWasmWorkerUrl(twitchBlobUrl);
            if (typeof jsURL !== 'string') {
                super(twitchBlobUrl);
                return;
            }
            var newBlobStr = `
                ${processM3U8.toString()}
                ${hookWorkerFetch.toString()}
                ${declareOptions.toString()}
                ${getAccessToken.toString()}
                ${gqlRequest.toString()}
                ${adRecordgqlPacket.toString()}
                ${tryNotifyTwitch.toString()}
                ${parseAttributes.toString()}
                declareOptions(self);
                self.addEventListener('message', function(e) {
                    if (e.data.key == 'SetCurrentPlayerQuality') {
                        CurrentVideoPlayerQuality = e.data.value;
                    } else if (e.data.key == 'UpdateClientVersion') {
                        ClientVersion = e.data.value;
                    } else if (e.data.key == 'UpdateClientId') {
                        ClientID = e.data.value;
                    } else if (e.data.key == 'UpdateDeviceId') {
                        GQLDeviceID = e.data.value;
                    } else if (e.data.key == 'SetHideBlockingMessage') {
                        if (e.data.value == "true") {
                        HideBlockingMessage = true;
                        } else if (e.data.value == "false") {
                        HideBlockingMessage = false;
                        }
                    }
                });
                hookWorkerFetch();
                importScripts('${jsURL}');
            `;
            super(URL.createObjectURL(new Blob([newBlobStr])));
            twitchMainWorker = this;
            this.onmessage = function(e) {
                if (e.data.key == 'GetVideoQuality') {
                    if (twitchMainWorker) {
                        var currentQuality = doTwitchPlayerTask(false, true);
                        if (twitchMainWorker) {
                            twitchMainWorker.postMessage({
                                key: 'SetCurrentPlayerQuality',
                                value: currentQuality
                            });
                        }
                    }
                } else if (e.data.key == 'ShowAdBlockBanner') {
                    if (adBlockDiv == null) {
                        adBlockDiv = getAdBlockDiv();
                    }
                    adBlockDiv.P.textContent = 'Blocking ads...';
                    adBlockDiv.style.display = 'block';
                } else if (e.data.key == 'HideAdBlockBanner') {
                    if (adBlockDiv == null) {
                        adBlockDiv = getAdBlockDiv();
                    }
                    adBlockDiv.style.display = 'none';
                } else if (e.data.key == 'PauseResumePlayer') {
                    doTwitchPlayerTask(true, false);
                } else if (e.data.key == 'ShowDonateBanner') {
                    if (adBlockDiv == null) {
                        adBlockDiv = getAdBlockDiv();
                    }
                    adBlockDiv.P.textContent = 'Help support us...';
                    adBlockDiv.style.display = 'block';
                }
            };

            function getAdBlockDiv() {
                //To display a notification to the user, that an ad is being blocked.
                var playerRootDiv = document.querySelector('.video-player');
                var adBlockDiv = null;
                if (playerRootDiv != null) {
                    adBlockDiv = playerRootDiv.querySelector('.adblock-overlay');
                    if (adBlockDiv == null) {
                        adBlockDiv = document.createElement('div');
                        adBlockDiv.className = 'adblock-overlay';
                        adBlockDiv.innerHTML = '<a href="https://paypal.me/ttvadblock" target="_blank"><div class="player-adblock-notice" style="color: white; background-color: rgba(0, 0, 0, 0.8); position: absolute; top: 0px; left: 0px; padding: 5px;"><p></p></div></a>';
                        adBlockDiv.style.display = 'none';
                        adBlockDiv.P = adBlockDiv.querySelector('p');
                        playerRootDiv.appendChild(adBlockDiv);
                    }
                }
                return adBlockDiv;
            }
        }
    };

    function getWasmWorkerUrl(twitchBlobUrl) {
        var req = new XMLHttpRequest();
        req.open('GET', twitchBlobUrl, false);
        req.send();
        return req.responseText.split("'")[1];
    }

    function hookWorkerFetch() {
        var realFetch = fetch;
        fetch = async function(url, options) {
            if (typeof url === 'string') {
                if (url.includes('video-weaver')) {
                    return new Promise(function(resolve, reject) {
                        var processAfter = async function(response) {
                            //Here we check the m3u8 for any ads and also try fallback player types if needed.
                            //We first check if we can get a source quality ad-free stream, but only if the user has source set on the player.
                            postMessage({
                                key: 'GetVideoQuality'
                            });

                            var responseText = await response.text();
                            var weaverText = null;

                            //Here we check the video player quality setting, if set to 720p or higher, we try for a source quality ad-free stream.
                            var isPlayerHighQuality = false;
                            if (CurrentVideoPlayerQuality) {
                                if (CurrentVideoPlayerQuality.includes('1080') || CurrentVideoPlayerQuality.includes('720')) {
                                    isPlayerHighQuality = true;
                                }
                            }

                            if (isPlayerHighQuality == true) {
                                weaverText = await processM3U8(url, responseText, realFetch, PlayerType1);
                                if (weaverText.includes(AdSignifier)) {
                                    weaverText = await processM3U8(url, responseText, realFetch, PlayerType2);
                                }
                                if (weaverText.includes(AdSignifier)) {
                                    weaverText = await processM3U8(url, responseText, realFetch, PlayerType3);
                                }
                                if (weaverText.includes(AdSignifier)) {
                                    weaverText = await processM3U8(url, responseText, realFetch, PlayerType4);
                                }
                            } else {
                                weaverText = await processM3U8(url, responseText, realFetch, PlayerType2);
                                if (weaverText.includes(AdSignifier)) {
                                    weaverText = await processM3U8(url, responseText, realFetch, PlayerType3);
                                }
                                if (weaverText.includes(AdSignifier)) {
                                    weaverText = await processM3U8(url, responseText, realFetch, PlayerType4);
                                }
                            }
                            resolve(new Response(weaverText));
                        };
                        var send = function() {
                            return realFetch(url, options).then(function(response) {
                                processAfter(response);
                            })['catch'](function(err) {
                                reject(err);
                            });
                        };
                        send();
                    });
                } else if (url.includes('/api/channel/hls/')) {
                    var channelName = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
                    UsherParams = (new URL(url)).search;
                    CurrentChannelName = channelName;
                    //To prevent pause/resume loop for mid-rolls.
                    var isPBYPRequest = url.includes('picture-by-picture');
                    if (isPBYPRequest) {
                        url = '';
                    }
                }
            }
            return realFetch.apply(this, arguments);
        };
    }

    async function processM3U8(url, textStr, realFetch, playerType) {
        //Checks the m3u8 for ads and if it finds one, instead returns an ad-free stream.
        if (!textStr) {
            return textStr;
        }

        if (!textStr.includes(".ts")) {
            return textStr;
        }

        var haveAdTags = textStr.includes(AdSignifier);

        if (haveAdTags) {

            //Reduces ad frequency.
            try {
                tryNotifyTwitch(textStr);
            } catch (err) {}

            var accessTokenResponse = await getAccessToken(CurrentChannelName, playerType);

            if (accessTokenResponse.status === 200) {

                var accessToken = await accessTokenResponse.json();

                try {
                    var urlInfo = new URL('https://usher.ttvnw.net/api/channel/hls/' + CurrentChannelName + '.m3u8' + UsherParams);
                    urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                    urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                    var encodingsM3u8Response = await realFetch(urlInfo.href);
                    if (encodingsM3u8Response.status === 200) {

                        var encodingsM3u8 = await encodingsM3u8Response.text();

                        //We check if user has the player set to 720p, if so, use that encoding. If not, it will use 1080p or 480p, depending on the current player setting.
                        var streamM3u8Url = null;
                        if (CurrentVideoPlayerQuality && CurrentVideoPlayerQuality.includes('720') && PlayerType1 == playerType) {
                            streamM3u8Url = encodingsM3u8.match(/^https:.*\.m3u8$/mg)[1];
                        } else {
                            streamM3u8Url = encodingsM3u8.match(/^https:.*\.m3u8$/mg)[0];
                        }

                        var streamM3u8Response = await realFetch(streamM3u8Url);
                        if (streamM3u8Response.status == 200) {
                            var m3u8Text = await streamM3u8Response.text();
                            WasShowingAd = true;
                            if (HideBlockingMessage == false) {
                                if (Math.floor(Math.random() * 4) == 3) {
                                    postMessage({
                                        key: 'ShowDonateBanner'
                                    });
                                } else {
                                    postMessage({
                                        key: 'ShowAdBlockBanner'
                                    });
                                }
                            } else if (HideBlockingMessage == true) {
                                postMessage({
                                    key: 'HideAdBlockBanner'
                                });
                            }
                            return m3u8Text;
                        } else {
                            return textStr;
                        }
                    } else {
                        return textStr;
                    }
                } catch (err) {}
                return textStr;
            } else {
                return textStr;
            }
        } else {
            if (WasShowingAd) {
                WasShowingAd = false;
                postMessage({
                    key: 'PauseResumePlayer'
                });
                postMessage({
                    key: 'HideAdBlockBanner'
                });
            }
            return textStr;
        }
        return textStr;
    }

    function parseAttributes(str) {
        return Object.fromEntries(
            str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/)
            .filter(Boolean)
            .map(x => {
                const idx = x.indexOf('=');
                const key = x.substring(0, idx);
                const value = x.substring(idx + 1);
                const num = Number(value);
                return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num];
            }));
    }

    async function tryNotifyTwitch(streamM3u8) {
        //We notify that an ad was requested but was not visible and was also muted.
        var matches = streamM3u8.match(/#EXT-X-DATERANGE:(ID="stitched-ad-[^\n]+)\n/);
        if (matches.length > 1) {
            const attrString = matches[1];
            const attr = parseAttributes(attrString);
            var podLength = parseInt(attr['X-TV-TWITCH-AD-POD-LENGTH'] ? attr['X-TV-TWITCH-AD-POD-LENGTH'] : '1');
            var podPosition = parseInt(attr['X-TV-TWITCH-AD-POD-POSITION'] ? attr['X-TV-TWITCH-AD-POD-POSITION'] : '0');
            var radToken = attr['X-TV-TWITCH-AD-RADS-TOKEN'];
            var lineItemId = attr['X-TV-TWITCH-AD-LINE-ITEM-ID'];
            var orderId = attr['X-TV-TWITCH-AD-ORDER-ID'];
            var creativeId = attr['X-TV-TWITCH-AD-CREATIVE-ID'];
            var adId = attr['X-TV-TWITCH-AD-ADVERTISER-ID'];
            var rollType = attr['X-TV-TWITCH-AD-ROLL-TYPE'].toLowerCase();
            const baseData = {
                stitched: true,
                roll_type: rollType,
                player_mute: true,
                player_volume: 0.0,
                visible: false,
            };
            for (let podPosition = 0; podPosition < podLength; podPosition++) {
                const extendedData = {
                    ...baseData,
                    ad_id: adId,
                    ad_position: podPosition,
                    duration: 0,
                    creative_id: creativeId,
                    total_ads: podLength,
                    order_id: orderId,
                    line_item_id: lineItemId,
                };
                await gqlRequest(adRecordgqlPacket('video_ad_impression', radToken, extendedData));
                for (let quartile = 0; quartile < 4; quartile++) {
                    await gqlRequest(
                        adRecordgqlPacket('video_ad_quartile_complete', radToken, {
                            ...extendedData,
                            quartile: quartile + 1,
                        })
                    );
                }
                await gqlRequest(adRecordgqlPacket('video_ad_pod_complete', radToken, baseData));
            }
        }
    }

    function adRecordgqlPacket(event, radToken, payload) {
        return [{
            operationName: 'ClientSideAdEventHandling_RecordAdEvent',
            variables: {
                input: {
                    eventName: event,
                    eventPayload: JSON.stringify(payload),
                    radToken,
                },
            },
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: '7e6c69e6eb59f8ccb97ab73686f3d8b7d85a72a0298745ccd8bfc68e4054ca5b',
                },
            },
        }];
    }

    function getAccessToken(channelName, playerType, realFetch) {
        var body = null;
        var templateQuery = 'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature    __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature    __typename  }}';
        body = {
            operationName: 'PlaybackAccessToken_Template',
            query: templateQuery,
            variables: {
                'isLive': true,
                'login': channelName,
                'isVod': false,
                'vodID': '',
                'playerType': playerType
            }
        };
        return gqlRequest(body, realFetch);
    }

    function gqlRequest(body, realFetch) {
        var fetchFunc = realFetch ? realFetch : fetch;
        if (!GQLDeviceID) {
            var dcharacters = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var dcharactersLength = dcharacters.length;
            for (var i = 0; i < 32; i++) {
                GQLDeviceID += dcharacters.charAt(Math.floor(Math.random() * dcharactersLength));
            }
        }
        return fetchFunc('https://gql.twitch.tv/gql', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'Client-ID': ClientID,
                'Device-ID': GQLDeviceID,
                'X-Device-Id': GQLDeviceID,
                'Client-Version': ClientVersion
            }
        });
    }

    function doTwitchPlayerTask(isPausePlay, isCheckQuality) {
        //This will do an instant pause/play to return to original quality once the ad is finished.
        //We also hide the controls while doing the pause/play to make the image more seamless.
        //Or we use this function to get the current video player quality set by the user.
        try {
            var videoController = null;
            if (isPausePlay) {
                videoController = document.querySelector('.video-player__overlay');
                if (videoController) {
                    videoController.style.visibility = "hidden";
                }
            }
            var videoPlayer = null;
            function findReactNode(root, constraint) {
                if (root.stateNode && constraint(root.stateNode)) {
                    return root.stateNode;
                }
                let node = root.child;
                while (node) {
                    const result = findReactNode(node, constraint);
                    if (result) {
                        return result;
                    }
                    node = node.sibling;
                }
                return null;
            }
            var reactRootNode = null;
            var rootNode = document.querySelector('#root');
            if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
                reactRootNode = rootNode._reactRootContainer._internalRoot.current;
            }
            if (!reactRootNode) {
                if (isPausePlay) {
                    if (videoController) {
                        videoController.style.visibility = "visible";
                    }
                }
                return;
            }
            videoPlayer = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
            videoPlayer = videoPlayer && videoPlayer.props && videoPlayer.props.mediaPlayerInstance ? videoPlayer.props.mediaPlayerInstance : null;
            if (!videoPlayer) {
                if (isPausePlay) {
                    if (videoController) {
                        videoController.style.visibility = "visible";
                    }
                }
                return;
            }
            if (videoPlayer.paused) {
                if (isPausePlay) {
                    if (videoController) {
                        videoController.style.visibility = "visible";
                    }
                }
                return;
            }
            if (isPausePlay) {
                videoPlayer.pause();
                videoPlayer.play();
                setTimeout(function() {
                    if (videoController) {
                        videoController.style.visibility = "visible";
                    }
                }, 6500);
                return;
            }
            if (isCheckQuality) {
                if (typeof videoPlayer.getQuality() == 'undefined') {
                    return;
                }
                var playerQuality = JSON.stringify(videoPlayer.getQuality());
                if (playerQuality) {
                    return playerQuality;
                } else {
                    return;
                }
            }
        } catch (err) {
            if (isPausePlay) {
                var videoController = document.querySelector('.video-player__overlay');
                if (videoController) {
                    videoController.style.visibility = "visible";
                }
            }
        }
    }

    function hookFetch() {
        var realFetch = window.fetch;
        window.fetch = function(url, init, ...args) {
            if (typeof url === 'string') {
                if (url.includes('/access_token') || url.includes('gql')) {
                    //Device ID is used when notifying Twitch of ads.
                    var deviceId = init.headers['X-Device-Id'];
                    if (typeof deviceId !== 'string') {
                        deviceId = init.headers['Device-ID'];
                    }
                    if (typeof deviceId === 'string') {
                        GQLDeviceID = deviceId;
                    }
                    if (GQLDeviceID && twitchMainWorker) {
                        twitchMainWorker.postMessage({
                            key: 'UpdateDeviceId',
                            value: GQLDeviceID
                        });
                    }
                    //Client version is used in GQL requests.
                    var clientVersion = init.headers['Client-Version'];
                    if (clientVersion && typeof clientVersion == 'string') {
                        ClientVersion = clientVersion;
                    }
                    if (ClientVersion && twitchMainWorker) {
                        twitchMainWorker.postMessage({
                            key: 'UpdateClientVersion',
                            value: ClientVersion
                        });
                    }
                    //Client ID is used in GQL requests.
                    var clientId = init.headers['Client-ID'];
                    if (clientId && typeof clientId == 'string') {
                        ClientID = clientId;
                    } else {
                        clientId = init.headers['Client-Id'];
                        if (clientId && typeof clientId == 'string') {
                            ClientID = clientId;
                        }
                    }
                    if (ClientID && twitchMainWorker) {
                        twitchMainWorker.postMessage({
                            key: 'UpdateClientId',
                            value: ClientID
                        });
                    }
                    //To prevent pause/resume loop for mid-rolls.
                    if (url.includes('gql') && init && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken') && init.body.includes('picture-by-picture')) {
                        init.body = '';
                    }
                    var isPBYPRequest = url.includes('picture-by-picture');
                    if (isPBYPRequest) {
                        url = '';
                    }
                }
            }
            return realFetch.apply(this, arguments);
        };
    }
    hookFetch();
}

function appendBlockingScript() {
    var script = document.createElement('script');
    script.appendChild(document.createTextNode('(' + removeVideoAds + ')();'));
    (document.body || document.head || document.documentElement).appendChild(script);
    setTimeout(function() {
        updateSettings();
    }, 4000);
}

if (isFirefox) {
    var onOff = browser.storage.sync.get('onOffTTV');
    onOff.then((res) => {
        if (res && res.onOffTTV) {
            if (res.onOffTTV == "true") {
                appendBlockingScript();
            }
        } else {
            appendBlockingScript();
        }
    }, err => {
        appendBlockingScript();
    });
} else {
    chrome.storage.local.get(['onOffTTV'], function(result) {
        if (chrome.runtime.lastError) {
            appendBlockingScript();
            return;
        }
        if (result && result.onOffTTV) {
            if (result.onOffTTV == "true") {
                appendBlockingScript();
            }
        } else {
            appendBlockingScript();
        }
    });
}