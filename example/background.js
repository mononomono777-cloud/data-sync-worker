
// SF6 Act Analyzer - Background Script with Real Parsing (Raw Data Mode + FORCED TIMEOUTS + LOG-BASED API)

const TARGET_DOMAIN = "https://www.streetfighter.com";
const BUCKLER_URL = `${TARGET_DOMAIN}/6/buckler`; // Default base

// Helpers
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Robust Fetch with AbortController
async function safeFetch(url, options = {}, timeLimit = 8000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeLimit);
    const finalOptions = {
        ...options,
        signal: controller.signal,
        credentials: 'include'
    };

    console.time(`[BG] Fetch ${url}`);
    console.log(`[BG] safeFetch Start: ${url} (Timeout: ${timeLimit}ms)`);

    try {
        const response = await fetch(url, finalOptions);
        clearTimeout(timeoutId);
        console.timeEnd(`[BG] Fetch ${url}`);
        console.log(`[BG] safeFetch Done: ${url} Status: ${response.status}`);
        return response;
    } catch (e) {
        console.timeEnd(`[BG] Fetch ${url}`);
        if (e.name === 'AbortError') {
            console.warn(`[BG] Fetch ABORTED (Timeout): ${url}`);
        } else {
            console.warn(`[BG] Fetch Failed: ${url}`, e);
        }
        throw e;
    }
}

// Listen for messages 
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[BG] Received message:", message.type, message);

    if (message.type === 'CHECK_SESSION') {
        checkSession().then(sendResponse);
        return true;
    }
    if (message.type === 'FETCH_BATTLE_LOG') {
        sendResponse({ status: 'STARTED' });
        fetchBattleLogSafe(message.targetId)
            .then(data => {
                chrome.runtime.sendMessage({ type: 'FETCH_COMPLETE', data: data }).catch(() => { });
            })
            .catch(err => {
                chrome.runtime.sendMessage({ type: 'FETCH_ERROR', message: err.message }).catch(() => { });
            });
        return false;
    }
    if (message.type === 'FETCH_DASHBOARD_DATA') {
        fetchDashboardData(message.targetId)
            .then(data => sendResponse(data))
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }
    if (message.type === 'FETCH_OPPONENT_INFO') {
        fetchOpponentInfo(message.targetId)
            .then(data => sendResponse(data))
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }
    if (message.type === 'FETCH_OPPONENT_MR_HISTORY') {
        fetchPlayData(message.targetId, true) // true = skipCache & skipSave
            .then(data => sendResponse({ status: 'SUCCESS', data: data }))
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }

    if (message.type === 'FETCH_OPPONENT_SUMMARY') {
        getOpponentSummary(message.targetId)
            .then(data => sendResponse({ status: 'SUCCESS', data: data }))
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }

    if (message.type === 'QUEUE_OPPONENT_SUMMARY_BATCH') {
        // Non-blocking, return immediately
        sendResponse({ status: 'QUEUED' });
        enqueueOpponentBatch(message.targetIds);
        return false;
    }

    // --- NEW INDIVIDUAL FETCH HANDLERS ---
    if (message.type === 'FETCH_USER_PROFILE_ONLY') {
        fetchUserProfile()
            .then(data => sendResponse({ status: 'SUCCESS', data: data }))
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }
    if (message.type === 'FETCH_BATTLE_LOG_ONLY') {
        fetchBattleLogSafe(message.targetId)
            .then(async data => {
                // Also update dashboard_data for UI consistency
                const s = await chrome.storage.local.get(['dashboard_data']);
                const dashboardData = s.dashboard_data || {};
                dashboardData.battle_stats = data;
                dashboardData.last_updated = new Date().toISOString();
                await chrome.storage.local.set({ dashboard_data: dashboardData });
                sendResponse({ status: 'SUCCESS', data: data });
            })
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }
    if (message.type === 'FETCH_PLAY_DATA_ONLY') {
        fetchPlayData(message.targetId)
            .then(async data => {
                // Return Map { charId: Array }
                const s = await chrome.storage.local.get(['dashboard_data']);
                const dashboardData = s.dashboard_data || {};
                dashboardData.mr_history = data; // Save raw

                dashboardData.last_updated = new Date().toISOString();
                await chrome.storage.local.set({ dashboard_data: dashboardData });
                sendResponse({ status: 'SUCCESS', data: data });
            })
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }
    if (message.type === 'FETCH_RANKING_ONLY') {
        (async () => {
            let characterName = message.charName;
            if (!characterName || characterName === '-' || characterName.toLowerCase() === 'unknown') {
                const s = await chrome.storage.local.get(['user_profile']);
                characterName = s.user_profile?.favoriteCharacter || s.user_profile?.favoriteCharacterName || 'gouki';
            }
            const global = await fetchRanking(message.targetId);
            const char = await fetchCharacterRanking(message.targetId, characterName);
            const results = { ...global, character_ranking: char };
            await chrome.storage.local.set({ ranking_stats: results });

            // Sync Dashboard
            const s2 = await chrome.storage.local.get(['dashboard_data']);
            const dashboardData = s2.dashboard_data || {};
            dashboardData.ranking = global;
            dashboardData.character_ranking = char;
            dashboardData.last_updated = new Date().toISOString();
            await chrome.storage.local.set({ dashboard_data: dashboardData });

            return results;
        })()
            .then(data => sendResponse({ status: 'SUCCESS', data: data }))
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }

    if (message.type === 'FETCH_BATTLE_STATS') {
        fetchBattleStats(message.targetId)
            .then(async stats => {
                const s = await chrome.storage.local.get(['dashboard_data']);
                const dashboardData = s.dashboard_data || {};
                dashboardData.detailed_stats = stats;
                dashboardData.last_updated = new Date().toISOString();
                await chrome.storage.local.set({ dashboard_data: dashboardData });
                sendResponse({ status: 'SUCCESS', data: stats });
            })
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }

    if (message.type === 'FETCH_PLAYER_INFO') {
        fetchPlayerInfo(message.targetId)
            .then(data => sendResponse({ status: 'SUCCESS', data: data }))
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }

    if (message.type === 'DOWNLOAD_RAW_DATA') {
        chrome.storage.local.get(['debug_raw_data'])
            .then(result => {
                const rawData = result.debug_raw_data || {};
                const jsonStr = JSON.stringify(rawData, null, 2);
                const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
                sendResponse({ status: 'SUCCESS', dataUrl: dataUrl, timestamp: new Date().toISOString() });
            })
            .catch(err => sendResponse({ status: 'ERROR', message: err.message }));
        return true;
    }
});

async function checkSession() {
    try {
        const response = await fetch(`${BUCKLER_URL}/top`, { redirect: 'manual' });
        if (response.type === 'opaqueredirect' || response.status === 302 || response.url.includes("cacapcom")) {
            return { loggedIn: false };
        }
        return { loggedIn: true };
    } catch (e) {
        return { loggedIn: false };
    }
}

// ----------------------------------------------------
// BATTLE LOG LOGIC
// ----------------------------------------------------

async function getMySid(htmlText = '') {
    try {
        // 1. If HTML provided (e.g. from checkSession or other fetches), parse it
        if (htmlText) {
            const nextMatch = htmlText.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
            if (nextMatch && nextMatch[1]) {
                try {
                    const data = JSON.parse(nextMatch[1]);
                    const sid = data.props?.pageProps?.componentProps?.header?.authenticator_info?.short_id;
                    if (sid) return String(sid);
                } catch (e) { }
            }
        }

        // 2. Fetch /top if needed
        const url = `${BUCKLER_URL}/top`;
        const res = await safeFetch(url, {}, 5000);
        if (!res.ok) return null;
        const html = await res.text();

        // __NEXT_DATA__
        const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (nextMatch && nextMatch[1]) {
            try {
                const data = JSON.parse(nextMatch[1]);
                const sid = data.props?.pageProps?.componentProps?.header?.authenticator_info?.short_id;
                if (sid) return String(sid);
            } catch (e) { }
        }

        // Try User Json
        try {
            const userRes = await safeFetch(`${BUCKLER_URL}/api/user/info`, {}, 3000);
            if (userRes.ok) {
                const j = await userRes.json();
                if (j && j.sid) return String(j.sid);
            }
        } catch (e) { }

        // Fallback: Link
        const linkMatch = html.match(/href=["']\/6\/buckler\/profile\/(\d+)["']/);
        if (linkMatch) return linkMatch[1];

        return null;
    } catch (e) {
        return null;
    }
}


// NEW ROBUST fetchBattleLogSafe
async function fetchBattleLogSafe(targetId = null) {
    console.log("[BG] Starting Safe Fetch Sequence (Sequential Strict)...");

    try {
        let shortId = targetId;
        let fighterName = "Unknown";

        // 1. Resolve ShortID from storage if not provided
        if (!shortId) {
            const s = await chrome.storage.local.get(['user_profile']);
            shortId = s.user_profile?.shortId;
            fighterName = s.user_profile?.fighterName || "Unknown";
        }

        // 2. If still no ID, try to fetch it live (Session check)
        if (!shortId) {
            console.log("[BG] No stored ID, attempting fresh profile fetch...");
            const userProfile = await fetchUserProfile();
            if (userProfile) {
                shortId = userProfile.shortId;
                fighterName = userProfile.fighterName;
            }
        }

        // 3. Last fallback: getMySid()
        if (!shortId) {
            shortId = await getMySid();
        }

        if (!shortId) {
            console.error("[BG] Cannot start fetch without ShortID.");
            return { status: 'ERROR', message: "User ID not detected. Please login to Buckler first." };
        }

        console.log(`[BG] Fetching Battle Log for: ${fighterName} (${shortId})`);

        const mySid = await getMySid(); // Confirmed "Me" for result calculation
        const baseUrl = `${BUCKLER_URL}/profile/${shortId}/battlelog/rank`;
        let allBattles = [];
        const MAX_PAGES = 10;

        for (let page = 1; page <= 10; page++) {
            chrome.runtime.sendMessage({ type: 'FETCH_PROGRESS', current: page, total: 10 }).catch(() => { });
            await sleep(getRandomInt(500, 1500));

            const pageUrl = `${baseUrl}?page=${page}`;
            console.log("[BG] Fetching BattleLog Page:", page);

            try {
                const response = await safeFetch(pageUrl, {}, 8000);
                if (response.url.includes("auth/login")) {
                    await chrome.storage.local.set({ is_logged_in: false });
                    return { status: 'NOT_LOGGED_IN' };
                }
                const text = await response.text();

                let pageBattles = parseBattleLogJson(text);
                if (pageBattles.length === 0) pageBattles = parseBattleLogHtml(text);

                if (pageBattles.length === 0) break;

                // Process win/loss relative to Me
                if (mySid) {
                    pageBattles = pageBattles.map(b => {
                        const isP1Me = String(b.p1Id) === String(mySid);
                        const isP2Me = String(b.p2Id) === String(mySid);
                        let result = 'UNKNOWN';
                        if (isP1Me) {
                            if (b.winner === 1) result = 'WIN';
                            else if (b.winner === 2) result = 'LOSE';
                            else result = 'DRAW';
                        } else if (isP2Me) {
                            if (b.winner === 2) result = 'WIN';
                            else if (b.winner === 1) result = 'LOSE';
                            else result = 'DRAW';
                        }
                        return { ...b, result };
                    });
                }

                allBattles = allBattles.concat(pageBattles);
                if (allBattles.length >= 100) break;

            } catch (e) {
                console.warn(`[BG] Failed to fetch page ${page}, skipping.`);
                break;
            }
        }

        const stats = calculateStats(allBattles);

        // Flatten structure for frontend compatibility (mockData.ts expects flat object with full_history)
        const storageData = { ...stats, lastUpdated: Date.now() };

        await chrome.storage.local.set({
            battle_stats: storageData
        });

        return storageData;

    } catch (error) {
        console.error("[BG] Fetch failed:", error);
        return { status: 'ERROR', message: error.message };
    }
}

// Reliable JSON Extraction
function extractJsonArray(text, startPattern) {
    const startIndex = text.search(startPattern);
    if (startIndex === -1) return null;
    const openIndex = text.indexOf('[', startIndex);
    if (openIndex === -1) return null;

    let balance = 0;
    let insideString = false;
    let escape = false;
    let endResult = -1;

    for (let i = openIndex; i < text.length; i++) {
        const char = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (char === '\\') {
            escape = true;
            continue;
        }
        if (char === '"') {
            insideString = !insideString;
            continue;
        }
        if (!insideString) {
            if (char === '[') balance++;
            else if (char === ']') {
                balance--;
                if (balance === 0) {
                    endResult = i + 1;
                    break;
                }
            }
        }
    }

    if (endResult !== -1) return text.substring(openIndex, endResult);
    return null;
}

function formatControlType(typeName) {
    if (!typeName) return "Unknown";
    if (typeName.toLowerCase().includes("classic")) return "Classic";
    if (typeName.toLowerCase().includes("modern")) return "Modern";
    if (typeName.includes("クラシック")) return "Classic";
    if (typeName.includes("モダン")) return "Modern";
    return typeName;
}

function parseBattleLogJson(htmlText) {
    const battles = [];
    try {
        let jsonString = extractJsonArray(htmlText, /replay_list\s*=\s*/);
        if (!jsonString) jsonString = extractJsonArray(htmlText, /"replay_list":\s*/);
        if (!jsonString) return [];

        const replayList = JSON.parse(jsonString);
        replayList.forEach(match => {
            try {
                const p1 = match.player1_info;
                const p2 = match.player2_info;
                // Calculate Score from round_results array
                // Example: [0, 1, 6] -> 1st round lose, 2nd win, 3rd win
                const p1RoundsArr = Array.isArray(p1.round_results) ? p1.round_results : [];
                const p2RoundsArr = Array.isArray(p2.round_results) ? p2.round_results : [];

                const p1Score = p1RoundsArr.filter(r => r > 0).length;
                const p2Score = p2RoundsArr.filter(r => r > 0).length;

                let p1Result = 'DRAW';
                if (p1Score > p2Score) p1Result = 'WIN';
                else if (p1Score < p2Score) p1Result = 'LOSE';

                battles.push({
                    date: new Date(match.uploaded_at * 1000).toLocaleString(),
                    timestamp: match.uploaded_at * 1000,
                    p1Result: p1Result,
                    p1Score: p1Score,
                    p2Score: p2Score,
                    p1Name: p1.player.fighter_id,
                    p1Id: String(p1.player.short_id),
                    p1Character: p1.playing_character_name,
                    p1Type: formatControlType(p1.battle_input_type_name),
                    p1Mr: p1.master_rating || p1.league_point,
                    p2Name: p2.player.fighter_id,
                    p2Id: String(p2.player.short_id),
                    p2Character: p2.playing_character_name,
                    p2Type: formatControlType(p2.battle_input_type_name),
                    p2Mr: p2.master_rating || p2.league_point,
                    replayId: match.replay_id
                });
            } catch (err) { }
        });
    } catch (e) { }
    return battles;
}

function parseBattleLogHtml(htmlText) {
    const battles = [];
    const entries = htmlText.split(/<li data-index="\d+">/);

    for (let i = 1; i < entries.length; i++) {
        const entryHtml = entries[i];
        if (!entryHtml.includes('battle_data_inner_log__')) continue;

        try {
            const dateMatch = entryHtml.match(/battle_data_date__[^>]+>([^<]+)</);

            const p1Block = entryHtml.split('battle_data_player1__')[1]?.split('battle_data_player2__')[0] || "";
            const p2Block = entryHtml.split('battle_data_player2__')[1] || "";

            const findShortId = (block) => {
                const hrefMatch = block.match(/href="\/6\/buckler\/profile\/(\d+)"/);
                return hrefMatch ? hrefMatch[1] : null;
            };

            const p1Id = findShortId(p1Block) || "Unknown";
            const p2Id = findShortId(p2Block) || "Unknown";

            const p1NameMatch = entryHtml.substring(entryHtml.indexOf('battle_data_name_p1__')).match(/battle_data_name__[^>]+>([^<]+)</);
            const p1Name = p1NameMatch ? p1NameMatch[1] : "Unknown";
            const p2NameMatch = entryHtml.substring(entryHtml.indexOf('battle_data_name_p2__')).match(/battle_data_name__[^>]+>([^<]+)</);
            const p2Name = p2NameMatch ? p2NameMatch[1] : "Unknown";

            let p1Result = 'UNKNOWN';
            if (entryHtml.includes('battle_data_win__')) p1Result = 'WIN';
            else if (entryHtml.includes('battle_data_lose__')) p1Result = 'LOSE';
            else if (entryHtml.includes('battle_data_draw__')) p1Result = 'DRAW';

            const extractCharInfo = (htmlChunk) => {
                const charMatch = htmlChunk.match(/alt="([^"]+)"/);
                let type = "Unknown";
                if (htmlChunk.includes('icon_c.png') || htmlChunk.includes('type_classic')) type = "Classic";
                else if (htmlChunk.includes('icon_m.png') || htmlChunk.includes('type_modern')) type = "Modern";
                return { character: charMatch ? charMatch[1] : "Unknown", controlType: type };
            };

            const p1Info = extractCharInfo(p1Block);
            const p2Info = extractCharInfo(p2Block);
            const replayMatch = entryHtml.match(/data-clipboard-text="([A-Z0-9]+)"/);

            if (dateMatch) {
                battles.push({
                    date: dateMatch[1],
                    p1Result: p1Result,
                    p1Name: p1Name, p1Id: p1Id, p1Character: p1Info.character, p1Type: p1Info.controlType,
                    p2Name: p2Name, p2Id: p2Id, p2Character: p2Info.character, p2Type: p2Info.controlType,
                    replayId: replayMatch ? replayMatch[1] : "-"
                });
            }
        } catch (e) { }
    }
    return battles;
}

function calculateStats(battles) {
    let wins = 0;
    let losses = 0;
    let draws = 0;

    battles.forEach(b => {
        if (b.result === 'WIN') wins++;
        else if (b.result === 'LOSE') losses++;
        else draws++; // Treat unknown as draw or ignore?
    });

    const total = wins + losses + draws;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : 0;

    return {
        totalMatches: total,
        wins,
        losses,
        draws,
        winRate,
        recent_battles: battles.slice(0, 20),
        full_history: battles
    };
}


// ----------------------------------------------------
// DASHBOARD DATA
// ----------------------------------------------------

async function fetchDashboardData(shortId) {
    try {
        // ... Similar to before
        const profile = await fetchUserProfile(shortId);
        const mainChar = profile.favoriteCharacter || "gouki";
        const ranking = await fetchCharacterRanking(shortId, mainChar);
        const detailed = await fetchBattleStats(shortId);
        const playData = await fetchPlayData(shortId, false);

        const dashboardData = {
            profile, ranking, detailed_stats: detailed, mr_history: playData
        };

        await chrome.storage.local.set({ dashboard_data: dashboardData });
        return { status: 'SUCCESS', data: dashboardData };
    } catch (e) {
        return { status: 'ERROR', message: e.message };
    }
}

async function fetchUserProfile(shortIdArg) {
    try {
        let shortId = shortIdArg;
        if (!shortId) shortId = await getMySid(); // Helper reuse

        const url = `${BUCKLER_URL}/profile/${shortId}`;
        const response = await safeFetch(url, {}, 5000);
        if (!response.ok) throw new Error("Profile Fetch Failed");
        const html = await response.text();

        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!match || !match[1]) throw new Error("No JSON in Profile");

        const data = JSON.parse(match[1]);
        const pInfo = data.props?.pageProps?.fighter_banner_info;

        const profile = {
            shortId: pInfo.personal_info.short_id,
            fighterName: pInfo.personal_info.fighter_id,
            favoriteCharacter: pInfo.favorite_character_tool_name,
            favoriteCharacterName: pInfo.favorite_character_name,
        };

        await chrome.storage.local.set({ user_profile: profile });
        return profile;

    } catch (e) {
        return {};
    }
}

// ----------------------------------------------------
// PLAY DATA (Act History)
// ----------------------------------------------------

async function fetchPlayData(shortId, skipCache = false) {
    try {
        if (!shortId) shortId = await getMySid();

        const url = `${BUCKLER_URL}/profile/${shortId}/play`;
        const response = await safeFetch(url, {}, 8000);
        if (!response.ok) return {};

        const html = await response.text();
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!match || !match[1]) return {};

        const json = JSON.parse(match[1]);
        const playData = json.props?.pageProps?.play;
        if (!playData) return {};

        const history = {}; // Map { charId: [ {date, mr} ] }

        // 1. Current
        const characterLeagueInfos = playData.character_league_infos || [];
        characterLeagueInfos.forEach(charInfo => {
            const charId = charInfo.character_id;
            const leagueInfo = charInfo.league_info;
            if (leagueInfo) {
                if (!history[charId]) history[charId] = [];
                const mr = leagueInfo.master_rating || leagueInfo.league_point;
                if (mr) {
                    history[charId].push({ date: Date.now(), mr: mr });
                }
            }
        });

        // 2. Fetch History API (Top Char)
        const topChar = characterLeagueInfos.sort((a, b) => (b.battle_count || 0) - (a.battle_count || 0))[0];
        if (topChar) {
            const charId = topChar.character_id;
            if (!history[charId]) history[charId] = [];

            const fetchAct = async (actId) => {
                try {
                    const api = `${BUCKLER_URL}/api/profile/play/act/leagueinfo`;
                    const res = await safeFetch(api, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ short_id: shortId, act_id: actId })
                    }, 2000);
                    if (!res.ok) return;
                    const j = await res.json();
                    const infos = j.response?.character_league_infos || [];
                    const info = infos.find(i => i.character_id === charId);
                    if (info && info.league_info) {
                        const mr = info.league_info.master_rating || info.league_info.league_point;
                        if (mr) {
                            const ACT_END_DATES = {
                                0: 1690156800000, 1: 1698796800000, 2: 1709001600000, 3: 1716336000000,
                                4: 1727136000000, 5: 1735689600000, 6: 1743465600000, 7: 1751328000000,
                                8: 1759276800000, 9: 1767225600000, 10: 1774915200000, 11: 1782777600000
                            };
                            const ts = ACT_END_DATES[actId] || Date.now();
                            if (!history[charId].some(h => Math.abs(h.date - ts) < 86400000)) {
                                history[charId].push({ date: ts, mr: mr });
                            }
                        }
                    }
                } catch (e) { }
            };

            const acts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
            for (const actId of acts) {
                await fetchAct(actId);
                await sleep(50);
            }
        }

        return history;

    } catch (e) {
        return {};
    }
}

// ----------------------------------------------------
// CHARACTER RANKING / FILTER MAP
// ----------------------------------------------------

const CHARACTER_ID_MAP = {
    "luke": "luke", "jamie": "jamie", "manon": "manon", "kimberly": "kimberly",
    "marisa": "marisa", "lily": "lily", "jp": "jp", "juri": "juri",
    "deejay": "deejay", "cammy": "cammy", "ryu": "ryu", "honda": "honda",
    "blanka": "blanka", "guile": "guile", "ken": "ken", "chunli": "chunli",
    "zangief": "zangief", "dhalsim": "dhalsim", "rashid": "rashid", "aki": "aki",
    "ed": "ed", "gouki": "gouki", "akuma": "gouki", "bison": "veaga", "terry": "terry", "mai": "mai"
};

const CHARACTER_FILTER_MAP = {
    "luke": 1, "jamie": 2, "manon": 3, "kimberly": 4,
    "marisa": 5, "lily": 6, "jp": 7, "juri": 8,
    "deejay": 9, "cammy": 10, "ryu": 11, "honda": 12,
    "blanka": 13, "guile": 14, "ken": 15, "chunli": 16,
    "zangief": 17, "dhalsim": 18, "rashid": 19, "aki": 20,
    "ed": 21, "gouki": 4, "bison": 23, "terry": 24, "mai": 25
};

async function fetchCharacterRanking(shortId, characterName) {
    if (!characterName) return { rank: "-", mr: "-" };

    if (!shortId) {
        const s = await chrome.storage.local.get(['user_profile']);
        shortId = s.user_profile?.shortId;
    }
    if (!shortId) shortId = await getMySid();
    if (!shortId) return { rank: "Unknown ID", mr: "-" };

    let charId = characterName.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if (CHARACTER_ID_MAP[charId]) charId = CHARACTER_ID_MAP[charId];

    if (charId === 'unknown' || !charId) charId = 'gouki';

    const filterId = CHARACTER_FILTER_MAP[charId] || "4";
    const url = `${BUCKLER_URL}/ranking/master?character_filter=${filterId}&character_id=${charId}&platform=1&home_filter=1&home_category_id=0&home_id=0&page=1&season_type=1`;

    try {
        const response = await safeFetch(url, {}, 8000);
        if (!response.ok) return { rank: "-", mr: "-" };
        const html = await response.text();

        const userLinkRegex = new RegExp(`href=["'][^"']*\\/profile\\/${shortId}["'][^>]*>([\\s\\S]*?)<\\/a>`, "i");
        const match = html.match(userLinkRegex);

        let rank = null;
        let mr = null;

        if (match && match[1]) {
            const innerHtml = match[1];
            const rankMatch = innerHtml.match(/<dt>\s*(\d+)位\s*<\/dt>/);
            if (rankMatch) rank = rankMatch[1];

            const mrMatch = innerHtml.match(/<dd>\s*(\d+)MR\s*<\/dd>/);
            if (mrMatch) mr = mrMatch[1];
        }

        if (rank && mr) return { rank: rank, mr: mr, character: charId };

        const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (nextMatch && nextMatch[1]) {
            const data = JSON.parse(nextMatch[1]);
            const masterData = data.props?.pageProps?.master_rating_ranking;
            let ri = masterData?.my_ranking_info;

            if (ri && ri.order) {
                return { rank: ri.order, mr: ri.rating || ri.league_point, character: charId };
            }
        }

        return { rank: "Unranked", mr: "N/A" };
    } catch (e) {
        return { rank: "Error", mr: "Error" };
    }
}

async function fetchRanking(shortId) {
    return { rank: "-", mr: "-" };
}

async function fetchBattleStats(shortId) {
    if (!shortId) shortId = await getMySid();
    const url = `${BUCKLER_URL}/profile/${shortId}/play`;
    try {
        const response = await safeFetch(url, {}, 8000);
        if (!response.ok) return {};
        const html = await response.text();
        return parseDetailedStats(html);
    } catch (e) {
        return {};
    }
}

function parseDetailedStats(html) {
    const stats = { battle_trends: [], drive_gauge: [], sa_gauge: [] };
    try {
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!match || !match[1]) return stats;

        const json = JSON.parse(match[1]);
        const battleStats = json.props?.pageProps?.play?.battle_stats;

        if (!battleStats) return stats;

        stats.battle_trends = [
            { label: "投げ回数", value: battleStats.throw_count },
            { label: "被投げ回数", value: battleStats.received_throw_count },
            { label: "投げ抜け回数", value: battleStats.throw_tech },
            { label: "スタン回数", value: battleStats.stun },
            { label: "被スタン回数", value: battleStats.received_stun },
            { label: "ドライブインパクト", value: battleStats.drive_impact },
            { label: "被ドライブインパクト", value: battleStats.received_drive_impact },
            { label: "パニッシュカウンター", value: battleStats.punish_counter },
            { label: "被パニッシュカウンター", value: battleStats.received_punish_counter },
            { label: "ジャストパリィ", value: battleStats.just_parry },
            { label: "画面端有利時間", value: battleStats.corner_time + "s" },
            { label: "画面端不利時間", value: battleStats.cornered_time + "s" }
        ];

        stats.drive_gauge = [
            { label: "ドライブパリィ", value: (battleStats.gauge_rate_drive_parry * 100).toFixed(1) + "%" },
            { label: "ドライブキャンセル", value: (battleStats.gauge_rate_drive_cancel * 100).toFixed(1) + "%" },
            { label: "ドライブインパクト", value: (battleStats.gauge_rate_drive_impact * 100).toFixed(1) + "%" },
            { label: "ドライブリバーサル", value: (battleStats.gauge_rate_drive_reversal * 100).toFixed(1) + "%" },
            { label: "オーバードライブ", value: (battleStats.gauge_rate_drive_od * 100).toFixed(1) + "%" },
            { label: "ドライブラッシュ", value: (battleStats.gauge_rate_drive_rush * 100).toFixed(1) + "%" }
        ];

        stats.sa_gauge = [
            { label: "SA Lv1", value: (battleStats.gauge_rate_sa_lv1 * 100).toFixed(1) + "%" },
            { label: "SA Lv2", value: (battleStats.gauge_rate_sa_lv2 * 100).toFixed(1) + "%" },
            { label: "SA Lv3 / CA", value: ((battleStats.gauge_rate_sa_lv3 || 0) * 100 + (battleStats.gauge_rate_sa_ca || 0) * 100).toFixed(1) + "%" }
        ];

        return stats;
    } catch (e) {
        return stats;
    }
}

// ----------------------------------------------------
// OPPONENT SUMMARY / BATCH
// ----------------------------------------------------

async function getOpponentSummary(shortId) {
    if (!shortId || shortId === "undefined") return null;

    const cacheKey = `opp_summary_${shortId}`;
    try {
        const cached = await chrome.storage.local.get([cacheKey]);
        if (cached[cacheKey]) {
            if (Date.now() - cached[cacheKey].timestamp < 1000 * 60 * 30) {
                return cached[cacheKey].summary;
            }
        }

        let playData = await fetchPlayData(shortId, true);

        let maxMr = 0;
        let currentMr = 0;
        let mainChar = "unknown";
        let latestDate = 0;

        Object.entries(playData).forEach(([char, history]) => {
            if (!Array.isArray(history)) return;
            history.forEach(h => {
                if (h.mr > maxMr) maxMr = h.mr;
                if (h.date > latestDate) {
                    latestDate = h.date;
                    currentMr = h.mr;
                    mainChar = char;
                }
            });
        });

        const summary = {
            fighter_id: shortId,
            current_mr: currentMr,
            highest_mr: maxMr,
            main_character: mainChar,
            updated_at: Date.now()
        };

        await chrome.storage.local.set({
            [cacheKey]: { timestamp: Date.now(), summary: summary }
        });

        return summary;
    } catch (e) {
        console.error(`[BG] Summary Fetch Failed for ${shortId}:`, e);
        throw e;
    }
}

let batchQueue = [];
let isBatchProcessing = false;

async function enqueueOpponentBatch(ids) {
    if (!ids || ids.length === 0) return;
    ids.forEach(id => {
        if (!batchQueue.includes(id)) batchQueue.push(id);
    });
    processBatchQueue();
}

async function processBatchQueue() {
    if (isBatchProcessing || batchQueue.length === 0) return;
    isBatchProcessing = true;
    console.log(`[BG] Processing Batch Queue: ${batchQueue.length} items`);

    try {
        const batch = batchQueue.splice(0, 5);
        const results = {};

        const promises = batch.map(async (id) => {
            try {
                const history = await fetchPlayData(id, true);
                results[id] = history;
            } catch (e) { }
        });

        await Promise.all(promises);

        const data = await chrome.storage.local.get(['opponents_history']);
        const store = data.opponents_history || {};

        Object.keys(results).forEach(id => {
            store[id] = results[id];
        });

        await chrome.storage.local.set({ opponents_history: store });

    } catch (e) {
    } finally {
        isBatchProcessing = false;
        if (batchQueue.length > 0) {
            setTimeout(processBatchQueue, 2000);
        }
    }
}

// ----------------------------------------------------
// PLAYER INFO LOOKUP
// ----------------------------------------------------

async function fetchPlayerInfo(shortId) {
    if (!shortId) throw new Error("Short ID is required.");
    console.log(`[BG] fetchPlayerInfo: ${shortId}`);

    const playPageUrl = `${BUCKLER_URL}/profile/${shortId}/play`;
    const browserHeaders = {
        'Origin': TARGET_DOMAIN,
        'Referer': `${TARGET_DOMAIN}/6/buckler/ja-jp/profile/${shortId}/play`,
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty'
    };

    // 1. Fetch Profile page
    const profileUrl = `${BUCKLER_URL}/profile/${shortId}`;
    const profileRes = await safeFetch(profileUrl, {
        headers: { 'Referer': `${TARGET_DOMAIN}/6/buckler/ja-jp/profile/${shortId}` }
    }, 8000);
    if (!profileRes.ok) throw new Error(`Profile fetch failed (${profileRes.status})`);
    const profileHtml = await profileRes.text();

    const profileMatch = profileHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!profileMatch || !profileMatch[1]) throw new Error("No __NEXT_DATA__ in profile page");

    const profileJson = JSON.parse(profileMatch[1]);
    const bannerInfo = profileJson.props?.pageProps?.fighter_banner_info;
    if (!bannerInfo) throw new Error("No fighter_banner_info in profile");

    const result = {
        shortId: String(bannerInfo.personal_info?.short_id || shortId),
        fighterName: bannerInfo.personal_info?.fighter_id || "Unknown",
        favoriteCharacter: bannerInfo.favorite_character_tool_name || "",
        favoriteCharacterName: bannerInfo.favorite_character_name || "Unknown",
        favoriteCharLP: null,
        favoriteCharMR: null,
        currentActCharacters: [],
        pastActCharacters: {}
    };

    // 2. Fetch Play page (human-like delay)
    await sleep(getRandomInt(1500, 3000));
    const playRes = await safeFetch(playPageUrl, {
        headers: { 'Referer': `${TARGET_DOMAIN}/6/buckler/ja-jp/profile/${shortId}` }
    }, 8000);
    if (!playRes.ok) {
        console.warn(`[BG] Play page fetch failed for ${shortId}`);
        return result;
    }
    const playHtml = await playRes.text();

    const playMatch = playHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!playMatch || !playMatch[1]) return result;

    const playJson = JSON.parse(playMatch[1]);
    const playData = playJson.props?.pageProps?.play;
    if (!playData) return result;

    // 3. Parse current Act characters
    const charLeagueInfos = playData.character_league_infos || [];
    charLeagueInfos.forEach(charInfo => {
        const li = charInfo.league_info;
        if (!li) return;
        const entry = {
            characterId: charInfo.character_id || "",
            characterName: charInfo.character_name || charInfo.character_id || "Unknown",
            lp: li.league_point || 0,
            mr: li.master_rating || 0
        };
        result.currentActCharacters.push(entry);

        // Match favorite character
        if (result.favoriteCharacter && charInfo.character_id === result.favoriteCharacter) {
            result.favoriteCharLP = entry.lp;
            result.favoriteCharMR = entry.mr;
        }
    });

    // Also try matching by name if tool_name didn't match
    if (result.favoriteCharLP === null && result.favoriteCharacterName) {
        const favEntry = result.currentActCharacters.find(c =>
            c.characterName === result.favoriteCharacterName ||
            c.characterId === result.favoriteCharacter
        );
        if (favEntry) {
            result.favoriteCharLP = favEntry.lp;
            result.favoriteCharMR = favEntry.mr;
        }
    }

    // 4. Fetch past Acts (0-11) with browser-like headers and human-like intervals
    const acts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    for (const actId of acts) {
        try {
            await sleep(getRandomInt(1500, 3000)); // Human-like interval
            const api = `${BUCKLER_URL}/api/profile/play/act/leagueinfo`;
            const res = await safeFetch(api, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...browserHeaders
                },
                body: JSON.stringify({ short_id: shortId, act_id: actId })
            }, 5000);
            if (!res.ok) continue;
            const j = await res.json();
            const infos = j.response?.character_league_infos || [];
            if (infos.length === 0) continue;

            result.pastActCharacters[actId] = infos.map(ci => ({
                characterId: ci.character_id || "",
                characterName: ci.character_name || ci.character_id || "Unknown",
                lp: ci.league_info?.league_point || 0,
                mr: ci.league_info?.master_rating || 0
            }));
        } catch (e) {
            console.warn(`[BG] Act ${actId} fetch failed for ${shortId}`);
        }
    }

    console.log(`[BG] fetchPlayerInfo complete for ${shortId}:`, result);
    return result;
}
