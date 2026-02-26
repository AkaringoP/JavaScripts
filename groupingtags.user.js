// ==UserScript==
// @name         Danbooru Grouping Tags
// @namespace    http://tampermonkey.net/
// @version      1.0
// @author       AkaringoP
// @description  Grouping Tags for Danbooru
// @icon         https://danbooru.donmai.us/favicon.ico
// @match        https://danbooru.donmai.us/posts/*
// @require      https://cdn.jsdelivr.net/npm/systemjs@6.15.1/dist/system.min.js
// @require      https://cdn.jsdelivr.net/npm/systemjs@6.15.1/dist/extras/named-register.min.js
// @require      data:application/javascript,%3B(typeof%20System!%3D'undefined')%26%26(System%3Dnew%20System.constructor())%3B
// @connect      api.github.com
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// ==/UserScript==


System.register("./__entry.js", ['./main-BVjALz1Y-DsQB-M80.js'], (function (exports, module) {
	'use strict';
	return {
		setters: [null],
		execute: (function () {



		})
	};
}));

System.register("./main-BVjALz1Y-DsQB-M80.js", [], (function (exports, module) {
  'use strict';
  return {
    execute: (function () {

      exports({
        d: detectDarkTheme,
        g: gmFetch,
        s: sanitizeShardData
      });

      var _GM_deleteValue = (() => typeof GM_deleteValue != "undefined" ? GM_deleteValue : void 0)();
      var _GM_getValue = (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
      var _GM_setValue = (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
      var _GM_xmlhttpRequest = (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
      class AuthManager {
        static KEY = "github_gist_token";
        static GIST_ID_KEY = "my_gist_id";
static async getToken(silent = false) {
          const token = _GM_getValue(this.KEY, null);
          return token;
        }
static async setToken(token) {
          await _GM_setValue(this.KEY, token);
        }
static getGistId() {
          return _GM_getValue(this.GIST_ID_KEY, null);
        }
static setGistId(id) {
          _GM_setValue(this.GIST_ID_KEY, id);
        }
static clearAuth() {
          _GM_deleteValue(this.KEY);
          _GM_deleteValue(this.GIST_ID_KEY);
        }
      } exports("A", AuthManager);
      const auth = exports("a", Object.freeze( Object.defineProperty({
        __proto__: null,
        AuthManager
      }, Symbol.toStringTag, { value: "Module" })));
      const SAFE_GROUP_REGEX = /^[a-zA-Z0-9_\-\(\)\s]+$/;
      const SAFE_TAG_REGEX = /^[^\s\x00-\x1F\x7F]+$/;
      const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
      function sanitizeShardData(rawData) {
        if (!rawData || typeof rawData !== "object") {
          console.warn("⚠️ Security Warning: Invalid data format");
          return {};
        }
        const cleanData = {};
        for (const [postId, postData] of Object.entries(rawData)) {
          if (!/^\d+$/.test(postId)) continue;
          const safePost = {
            updatedAt: 0,
groups: {}
          };
          if (!postData || typeof postData !== "object") continue;
          const pData = postData;
          const ts = pData.updatedAt || pData.updated_at;
          if (typeof ts === "number") {
            safePost.updatedAt = ts;
          }
          const isImp = pData.isImported !== void 0 ? pData.isImported : pData.is_imported;
          if (typeof isImp === "boolean") {
            safePost.isImported = isImp;
          }
          if (pData.groups && typeof pData.groups === "object") {
            for (const [groupName, tags] of Object.entries(pData.groups)) {
              if (FORBIDDEN_KEYS.has(groupName)) {
                console.warn(
                  `🚨 Security Warning: Polluted key detected (${groupName})`
                );
                continue;
              }
              if (!SAFE_GROUP_REGEX.test(groupName)) {
                console.warn(
                  `⚠️ Security Warning: Invalid characters in group name (${groupName})`
                );
                continue;
              }
              if (Array.isArray(tags)) {
                const cleanTags = tags.filter(
                  (tag) => typeof tag === "string" && SAFE_TAG_REGEX.test(tag)
                );
                if (cleanTags.length > 0) {
                  safePost.groups[groupName] = cleanTags;
                }
              }
            }
          }
          if (Object.keys(safePost.groups).length > 0) {
            cleanData[postId] = safePost;
          }
        }
        return cleanData;
      }
      var lzString = { exports: {} };
      var hasRequiredLzString;
      function requireLzString() {
        if (hasRequiredLzString) return lzString.exports;
        hasRequiredLzString = 1;
        (function(module) {
          var LZString = (function() {
            var f = String.fromCharCode;
            var keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
            var keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
            var baseReverseDic = {};
            function getBaseValue(alphabet, character) {
              if (!baseReverseDic[alphabet]) {
                baseReverseDic[alphabet] = {};
                for (var i = 0; i < alphabet.length; i++) {
                  baseReverseDic[alphabet][alphabet.charAt(i)] = i;
                }
              }
              return baseReverseDic[alphabet][character];
            }
            var LZString2 = {
              compressToBase64: function(input) {
                if (input == null) return "";
                var res = LZString2._compress(input, 6, function(a) {
                  return keyStrBase64.charAt(a);
                });
                switch (res.length % 4) {
default:
case 0:
                    return res;
                  case 1:
                    return res + "===";
                  case 2:
                    return res + "==";
                  case 3:
                    return res + "=";
                }
              },
              decompressFromBase64: function(input) {
                if (input == null) return "";
                if (input == "") return null;
                return LZString2._decompress(input.length, 32, function(index) {
                  return getBaseValue(keyStrBase64, input.charAt(index));
                });
              },
              compressToUTF16: function(input) {
                if (input == null) return "";
                return LZString2._compress(input, 15, function(a) {
                  return f(a + 32);
                }) + " ";
              },
              decompressFromUTF16: function(compressed) {
                if (compressed == null) return "";
                if (compressed == "") return null;
                return LZString2._decompress(compressed.length, 16384, function(index) {
                  return compressed.charCodeAt(index) - 32;
                });
              },
compressToUint8Array: function(uncompressed) {
                var compressed = LZString2.compress(uncompressed);
                var buf = new Uint8Array(compressed.length * 2);
                for (var i = 0, TotalLen = compressed.length; i < TotalLen; i++) {
                  var current_value = compressed.charCodeAt(i);
                  buf[i * 2] = current_value >>> 8;
                  buf[i * 2 + 1] = current_value % 256;
                }
                return buf;
              },
decompressFromUint8Array: function(compressed) {
                if (compressed === null || compressed === void 0) {
                  return LZString2.decompress(compressed);
                } else {
                  var buf = new Array(compressed.length / 2);
                  for (var i = 0, TotalLen = buf.length; i < TotalLen; i++) {
                    buf[i] = compressed[i * 2] * 256 + compressed[i * 2 + 1];
                  }
                  var result = [];
                  buf.forEach(function(c) {
                    result.push(f(c));
                  });
                  return LZString2.decompress(result.join(""));
                }
              },
compressToEncodedURIComponent: function(input) {
                if (input == null) return "";
                return LZString2._compress(input, 6, function(a) {
                  return keyStrUriSafe.charAt(a);
                });
              },
decompressFromEncodedURIComponent: function(input) {
                if (input == null) return "";
                if (input == "") return null;
                input = input.replace(/ /g, "+");
                return LZString2._decompress(input.length, 32, function(index) {
                  return getBaseValue(keyStrUriSafe, input.charAt(index));
                });
              },
              compress: function(uncompressed) {
                return LZString2._compress(uncompressed, 16, function(a) {
                  return f(a);
                });
              },
              _compress: function(uncompressed, bitsPerChar, getCharFromInt) {
                if (uncompressed == null) return "";
                var i, value, context_dictionary = {}, context_dictionaryToCreate = {}, context_c = "", context_wc = "", context_w = "", context_enlargeIn = 2, context_dictSize = 3, context_numBits = 2, context_data = [], context_data_val = 0, context_data_position = 0, ii;
                for (ii = 0; ii < uncompressed.length; ii += 1) {
                  context_c = uncompressed.charAt(ii);
                  if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
                    context_dictionary[context_c] = context_dictSize++;
                    context_dictionaryToCreate[context_c] = true;
                  }
                  context_wc = context_w + context_c;
                  if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
                    context_w = context_wc;
                  } else {
                    if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                      if (context_w.charCodeAt(0) < 256) {
                        for (i = 0; i < context_numBits; i++) {
                          context_data_val = context_data_val << 1;
                          if (context_data_position == bitsPerChar - 1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                          } else {
                            context_data_position++;
                          }
                        }
                        value = context_w.charCodeAt(0);
                        for (i = 0; i < 8; i++) {
                          context_data_val = context_data_val << 1 | value & 1;
                          if (context_data_position == bitsPerChar - 1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                          } else {
                            context_data_position++;
                          }
                          value = value >> 1;
                        }
                      } else {
                        value = 1;
                        for (i = 0; i < context_numBits; i++) {
                          context_data_val = context_data_val << 1 | value;
                          if (context_data_position == bitsPerChar - 1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                          } else {
                            context_data_position++;
                          }
                          value = 0;
                        }
                        value = context_w.charCodeAt(0);
                        for (i = 0; i < 16; i++) {
                          context_data_val = context_data_val << 1 | value & 1;
                          if (context_data_position == bitsPerChar - 1) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                          } else {
                            context_data_position++;
                          }
                          value = value >> 1;
                        }
                      }
                      context_enlargeIn--;
                      if (context_enlargeIn == 0) {
                        context_enlargeIn = Math.pow(2, context_numBits);
                        context_numBits++;
                      }
                      delete context_dictionaryToCreate[context_w];
                    } else {
                      value = context_dictionary[context_w];
                      for (i = 0; i < context_numBits; i++) {
                        context_data_val = context_data_val << 1 | value & 1;
                        if (context_data_position == bitsPerChar - 1) {
                          context_data_position = 0;
                          context_data.push(getCharFromInt(context_data_val));
                          context_data_val = 0;
                        } else {
                          context_data_position++;
                        }
                        value = value >> 1;
                      }
                    }
                    context_enlargeIn--;
                    if (context_enlargeIn == 0) {
                      context_enlargeIn = Math.pow(2, context_numBits);
                      context_numBits++;
                    }
                    context_dictionary[context_wc] = context_dictSize++;
                    context_w = String(context_c);
                  }
                }
                if (context_w !== "") {
                  if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                    if (context_w.charCodeAt(0) < 256) {
                      for (i = 0; i < context_numBits; i++) {
                        context_data_val = context_data_val << 1;
                        if (context_data_position == bitsPerChar - 1) {
                          context_data_position = 0;
                          context_data.push(getCharFromInt(context_data_val));
                          context_data_val = 0;
                        } else {
                          context_data_position++;
                        }
                      }
                      value = context_w.charCodeAt(0);
                      for (i = 0; i < 8; i++) {
                        context_data_val = context_data_val << 1 | value & 1;
                        if (context_data_position == bitsPerChar - 1) {
                          context_data_position = 0;
                          context_data.push(getCharFromInt(context_data_val));
                          context_data_val = 0;
                        } else {
                          context_data_position++;
                        }
                        value = value >> 1;
                      }
                    } else {
                      value = 1;
                      for (i = 0; i < context_numBits; i++) {
                        context_data_val = context_data_val << 1 | value;
                        if (context_data_position == bitsPerChar - 1) {
                          context_data_position = 0;
                          context_data.push(getCharFromInt(context_data_val));
                          context_data_val = 0;
                        } else {
                          context_data_position++;
                        }
                        value = 0;
                      }
                      value = context_w.charCodeAt(0);
                      for (i = 0; i < 16; i++) {
                        context_data_val = context_data_val << 1 | value & 1;
                        if (context_data_position == bitsPerChar - 1) {
                          context_data_position = 0;
                          context_data.push(getCharFromInt(context_data_val));
                          context_data_val = 0;
                        } else {
                          context_data_position++;
                        }
                        value = value >> 1;
                      }
                    }
                    context_enlargeIn--;
                    if (context_enlargeIn == 0) {
                      context_enlargeIn = Math.pow(2, context_numBits);
                      context_numBits++;
                    }
                    delete context_dictionaryToCreate[context_w];
                  } else {
                    value = context_dictionary[context_w];
                    for (i = 0; i < context_numBits; i++) {
                      context_data_val = context_data_val << 1 | value & 1;
                      if (context_data_position == bitsPerChar - 1) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                      } else {
                        context_data_position++;
                      }
                      value = value >> 1;
                    }
                  }
                  context_enlargeIn--;
                  if (context_enlargeIn == 0) {
                    context_enlargeIn = Math.pow(2, context_numBits);
                    context_numBits++;
                  }
                }
                value = 2;
                for (i = 0; i < context_numBits; i++) {
                  context_data_val = context_data_val << 1 | value & 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data_position = 0;
                    context_data.push(getCharFromInt(context_data_val));
                    context_data_val = 0;
                  } else {
                    context_data_position++;
                  }
                  value = value >> 1;
                }
                while (true) {
                  context_data_val = context_data_val << 1;
                  if (context_data_position == bitsPerChar - 1) {
                    context_data.push(getCharFromInt(context_data_val));
                    break;
                  } else context_data_position++;
                }
                return context_data.join("");
              },
              decompress: function(compressed) {
                if (compressed == null) return "";
                if (compressed == "") return null;
                return LZString2._decompress(compressed.length, 32768, function(index) {
                  return compressed.charCodeAt(index);
                });
              },
              _decompress: function(length, resetValue, getNextValue) {
                var dictionary = [], enlargeIn = 4, dictSize = 4, numBits = 3, entry = "", result = [], i, w, bits, resb, maxpower, power, c, data = { val: getNextValue(0), position: resetValue, index: 1 };
                for (i = 0; i < 3; i += 1) {
                  dictionary[i] = i;
                }
                bits = 0;
                maxpower = Math.pow(2, 2);
                power = 1;
                while (power != maxpower) {
                  resb = data.val & data.position;
                  data.position >>= 1;
                  if (data.position == 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                  }
                  bits |= (resb > 0 ? 1 : 0) * power;
                  power <<= 1;
                }
                switch (bits) {
                  case 0:
                    bits = 0;
                    maxpower = Math.pow(2, 8);
                    power = 1;
                    while (power != maxpower) {
                      resb = data.val & data.position;
                      data.position >>= 1;
                      if (data.position == 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                      }
                      bits |= (resb > 0 ? 1 : 0) * power;
                      power <<= 1;
                    }
                    c = f(bits);
                    break;
                  case 1:
                    bits = 0;
                    maxpower = Math.pow(2, 16);
                    power = 1;
                    while (power != maxpower) {
                      resb = data.val & data.position;
                      data.position >>= 1;
                      if (data.position == 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                      }
                      bits |= (resb > 0 ? 1 : 0) * power;
                      power <<= 1;
                    }
                    c = f(bits);
                    break;
                  case 2:
                    return "";
                }
                dictionary[3] = c;
                w = c;
                result.push(c);
                while (true) {
                  if (data.index > length) {
                    return "";
                  }
                  bits = 0;
                  maxpower = Math.pow(2, numBits);
                  power = 1;
                  while (power != maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position == 0) {
                      data.position = resetValue;
                      data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                  }
                  switch (c = bits) {
                    case 0:
                      bits = 0;
                      maxpower = Math.pow(2, 8);
                      power = 1;
                      while (power != maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position == 0) {
                          data.position = resetValue;
                          data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                      }
                      dictionary[dictSize++] = f(bits);
                      c = dictSize - 1;
                      enlargeIn--;
                      break;
                    case 1:
                      bits = 0;
                      maxpower = Math.pow(2, 16);
                      power = 1;
                      while (power != maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position == 0) {
                          data.position = resetValue;
                          data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                      }
                      dictionary[dictSize++] = f(bits);
                      c = dictSize - 1;
                      enlargeIn--;
                      break;
                    case 2:
                      return result.join("");
                  }
                  if (enlargeIn == 0) {
                    enlargeIn = Math.pow(2, numBits);
                    numBits++;
                  }
                  if (dictionary[c]) {
                    entry = dictionary[c];
                  } else {
                    if (c === dictSize) {
                      entry = w + w.charAt(0);
                    } else {
                      return null;
                    }
                  }
                  result.push(entry);
                  dictionary[dictSize++] = w + entry.charAt(0);
                  enlargeIn--;
                  w = entry;
                  if (enlargeIn == 0) {
                    enlargeIn = Math.pow(2, numBits);
                    numBits++;
                  }
                }
              }
            };
            return LZString2;
          })();
          if (module != null) {
            module.exports = LZString;
          } else if (typeof angular !== "undefined" && angular != null) {
            angular.module("LZString", []).factory("LZString", function() {
              return LZString;
            });
          }
        })(lzString);
        return lzString.exports;
      }
      var lzStringExports = exports("l", requireLzString());
      function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
          _GM_xmlhttpRequest({
            method: options.method || "GET",
            url,
            headers: options.headers,
            data: options.body,
            onload: (response) => {
              if (response.status >= 200 && response.status < 300) {
                resolve({
                  ok: true,
                  status: response.status,
                  json: () => {
                    try {
                      return Promise.resolve(JSON.parse(response.responseText));
                    } catch (e) {
                      return Promise.reject(e);
                    }
                  },
                  text: () => Promise.resolve(response.responseText)
                });
              } else {
                reject(
                  new Error(
                    `Request failed with status ${response.status}: ${response.statusText}`
                  )
                );
              }
            },
            onerror: (err) => reject(new Error("Network error")),
            ontimeout: () => reject(new Error("Timeout"))
          });
        });
      }
      const API_BASE = "https://api.github.com/gists";
      class SyncManager {
static getShardIndex(postId) {
          const lastChar = postId.slice(-1);
          const index = parseInt(lastChar, 10);
          return isNaN(index) ? 0 : index;
        }
static async syncShard(shardIndex, localShardData, silent = false) {
          const token = await AuthManager.getToken(silent);
          if (!token && silent) {
            return;
          }
          const gistId = AuthManager.getGistId();
          if (!token || !gistId) throw new Error("Authentication missing");
          const fileName = `tags_${shardIndex}.json`;
          const gistResponse = await gmFetch(`${API_BASE}/${gistId}`, {
            headers: {
              Authorization: `token ${token}`,
              "Cache-Control": "no-cache"
            }
          });
          const gistJson = await gistResponse.json();
          const fileNode = gistJson.files[fileName];
          let cloudData = {};
          if (fileNode && fileNode.content) {
            try {
              const decompressed = lzStringExports.decompressFromUTF16(fileNode.content);
              const rawJson = JSON.parse(decompressed || "{}");
              cloudData = sanitizeShardData(rawJson);
            } catch (e) {
              console.error("Data parse failed (Possibly corrupted)", e);
              cloudData = {};
            }
          }
          const mergedData = { ...cloudData };
          let hasChanges = false;
          for (const [postId, localPost] of Object.entries(localShardData)) {
            const cloudPost = cloudData[postId];
            const localPostForCloud = { ...localPost };
            let shouldUpdate = false;
            if (!cloudPost) {
              shouldUpdate = true;
            } else {
              const cloudTs = cloudPost.updatedAt || 0;
              if (localPost.updatedAt > cloudTs) {
                shouldUpdate = true;
              }
            }
            if (shouldUpdate) {
              mergedData[postId] = localPostForCloud;
              hasChanges = true;
            }
          }
          if (!hasChanges) {
            return;
          }
          const compressedPayload = lzStringExports.compressToUTF16(
            JSON.stringify(mergedData)
          );
          await gmFetch(`${API_BASE}/${gistId}`, {
            method: "PATCH",
            headers: {
              Authorization: `token ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              files: {
                [fileName]: { content: compressedPayload }
              }
            })
          });
        }
      }
      const syncManager = exports("b", Object.freeze( Object.defineProperty({
        __proto__: null,
        SyncManager
      }, Symbol.toStringTag, { value: "Module" })));
      const scriptRel = (function detectScriptRel() {
        const relList = typeof document !== "undefined" && document.createElement("link").relList;
        return relList && relList.supports && relList.supports("modulepreload") ? "modulepreload" : "preload";
      })();
      const assetsURL = function(dep) {
        return "/" + dep;
      };
      const seen = {};
      const __vitePreload = exports("_", function preload(baseModule, deps, importerUrl) {
        let promise = Promise.resolve();
        if (deps && deps.length > 0) {
          let allSettled = function(promises$2) {
            return Promise.all(promises$2.map((p) => Promise.resolve(p).then((value$1) => ({
              status: "fulfilled",
              value: value$1
            }), (reason) => ({
              status: "rejected",
              reason
            }))));
          };
          document.getElementsByTagName("link");
          const cspNonceMeta = document.querySelector("meta[property=csp-nonce]");
          const cspNonce = cspNonceMeta?.nonce || cspNonceMeta?.getAttribute("nonce");
          promise = allSettled(deps.map((dep) => {
            dep = assetsURL(dep);
            if (dep in seen) return;
            seen[dep] = true;
            const isCss = dep.endsWith(".css");
            const cssSelector = isCss ? '[rel="stylesheet"]' : "";
            if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) return;
            const link = document.createElement("link");
            link.rel = isCss ? "stylesheet" : scriptRel;
            if (!isCss) link.as = "script";
            link.crossOrigin = "";
            link.href = dep;
            if (cspNonce) link.setAttribute("nonce", cspNonce);
            document.head.appendChild(link);
            if (isCss) return new Promise((res, rej) => {
              link.addEventListener("load", res);
              link.addEventListener("error", () => rej( new Error(`Unable to preload CSS for ${dep}`)));
            });
          }));
        }
        function handlePreloadError(err$2) {
          const e$1 = new Event("vite:preloadError", { cancelable: true });
          e$1.payload = err$2;
          window.dispatchEvent(e$1);
          if (!e$1.defaultPrevented) throw err$2;
        }
        return promise.then((res) => {
          for (const item of res || []) {
            if (item.status !== "rejected") continue;
            handlePreloadError(item.reason);
          }
          return baseModule().catch(handlePreloadError);
        });
      });
      const DB_NAME = "GroupingTagsDB";
      const DB_VERSION = 1;
      const STORE_NAME = "post_tags";
      let dbPromise = null;
      const openDB = () => {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, DB_VERSION);
          request.onupgradeneeded = (event) => {
            const db2 = event.target.result;
            if (!db2.objectStoreNames.contains(STORE_NAME)) {
              db2.createObjectStore(STORE_NAME, { keyPath: "postId" });
            }
          };
          request.onsuccess = (event) => {
            const db2 = event.target.result;
            db2.onclose = () => {
              dbPromise = null;
            };
            resolve(db2);
          };
          request.onerror = (event) => {
            dbPromise = null;
            reject(event.target.error);
          };
        });
        return dbPromise;
      };
      const savePostTagData = async (data) => {
        const db2 = await openDB();
        return new Promise((resolve, reject) => {
          const transaction = db2.transaction([STORE_NAME], "readwrite");
          const store = transaction.objectStore(STORE_NAME);
          const request = store.put(data);
          request.onsuccess = () => {
            __vitePreload(async () => {
              const { AutoSyncManager: AutoSyncManager2 } = await Promise.resolve().then(() => autoSync);
              return { AutoSyncManager: AutoSyncManager2 };
            }, void 0 ).then(({ AutoSyncManager: AutoSyncManager2 }) => {
              AutoSyncManager2.notifyChange(data.postId);
            });
            resolve();
          };
          request.onerror = () => reject(request.error);
        });
      };
      const getPostTagData = async (postId) => {
        const db2 = await openDB();
        return new Promise((resolve, reject) => {
          const transaction = db2.transaction([STORE_NAME], "readonly");
          const store = transaction.objectStore(STORE_NAME);
          const request = store.get(postId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      };
      const deletePostTagData = async (postId) => {
        const db2 = await openDB();
        return new Promise((resolve, reject) => {
          const transaction = db2.transaction([STORE_NAME], "readwrite");
          const store = transaction.objectStore(STORE_NAME);
          const request = store.delete(postId);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      };
      async function getLocalDataByShard(shardIndex) {
        const db2 = await openDB();
        return new Promise((resolve, reject) => {
          const tx = db2.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const request = store.getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const allData = request.result;
            const shardData = {};
            allData.forEach((item) => {
              const pidStr = item.postId.toString();
              const lastChar = pidStr.slice(-1);
              const idx = parseInt(lastChar, 10);
              if (idx === shardIndex) {
                shardData[pidStr] = item;
              }
            });
            resolve(shardData);
          };
        });
      }
      const db = exports("c", Object.freeze( Object.defineProperty({
        __proto__: null,
        deletePostTagData,
        getLocalDataByShard,
        getPostTagData,
        openDB,
        savePostTagData
      }, Symbol.toStringTag, { value: "Module" })));
      const KEY_DIRTY_SHARDS = "dta_dirty_shards";
      const KEY_LAST_ACTIVITY = "dta_last_activity_ts";
      class AutoSyncManager {
        static syncTimeout = null;
static init() {
          this.checkPendingSync();
        }
static notifyChange(postId) {
          const pidStr = postId.toString();
          const shardIdx = SyncManager.getShardIndex(pidStr);
          const dirtyShards = this.getDirtyShards();
          if (!dirtyShards.includes(shardIdx)) {
            dirtyShards.push(shardIdx);
            _GM_setValue(KEY_DIRTY_SHARDS, dirtyShards);
          }
          const now = Date.now();
          _GM_setValue(KEY_LAST_ACTIVITY, now);
          if (this.syncTimeout) clearTimeout(this.syncTimeout);
          this.scheduleSync(5e3);
        }
static checkPendingSync() {
          const dirtyShards = this.getDirtyShards();
          if (dirtyShards.length === 0) return;
          const lastActive = _GM_getValue(KEY_LAST_ACTIVITY, 0);
          const now = Date.now();
          const elapsed = now - lastActive;
          const DEBOUNCE_TIME = 5e3;
          if (elapsed >= DEBOUNCE_TIME) {
            this.executeSync();
          } else {
            const remaining = DEBOUNCE_TIME - elapsed;
            this.scheduleSync(remaining);
          }
        }
        static scheduleSync(delayMs) {
          this.syncTimeout = setTimeout(() => this.executeSync(), delayMs);
        }
        static async executeSync() {
          const dirtyShards = this.getDirtyShards();
          if (dirtyShards.length === 0) return;
          for (const shardIdx of dirtyShards) {
            try {
              const localData = await getLocalDataByShard(shardIdx);
              await SyncManager.syncShard(shardIdx, localData, true);
            } catch (e) {
              console.error(`❌ AutoSync Failed for Shard ${shardIdx}:`, e);
            }
          }
          _GM_setValue(KEY_DIRTY_SHARDS, []);
        }
        static getDirtyShards() {
          return _GM_getValue(KEY_DIRTY_SHARDS, []);
        }
      }
      const autoSync = Object.freeze( Object.defineProperty({
        __proto__: null,
        AutoSyncManager
      }, Symbol.toStringTag, { value: "Module" }));
      function stringToColor(str, isDark) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const goldenRatio = 0.618033988749895;
        const seed = Math.abs(hash);
        const hue = Math.floor(seed * goldenRatio % 1 * 360);
        const sVar = seed % 20 - 10;
        const lVar = seed % 10 - 5;
        const saturation = (isDark ? 70 : 65) + sVar;
        const lightness = (isDark ? 70 : 45) + lVar;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
      }
      function detectDarkTheme() {
        const bg = window.getComputedStyle(document.body).backgroundColor;
        const rgb = bg.match(/\d+/g);
        if (rgb) {
          const r = parseInt(rgb[0]);
          const g = parseInt(rgb[1]);
          const b = parseInt(rgb[2]);
          return (r * 299 + g * 587 + b * 114) / 1e3 < 128;
        }
        return false;
      }
      function getPostId() {
        const match = window.location.pathname.match(/\/posts\/(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
        const form = document.querySelector("form#form");
        if (form) {
          const action = form.getAttribute("action");
          const actionMatch = action?.match(/\/posts\/(\d+)/);
          if (actionMatch) {
            return parseInt(actionMatch[1], 10);
          }
        }
        return null;
      }
      function showToast$1(message, type = "info", duration = 3e3) {
        const toast = document.createElement("div");
        toast.textContent = message;
        Object.assign(toast.style, {
          position: "fixed",
          bottom: "20px",
          left: "50%",
          transform: "translateX(-50%) translateY(20px)",
          backgroundColor: type === "error" ? "#d32f2f" : "#323232",
          color: "#fff",
          padding: "10px 20px",
          borderRadius: "4px",
          fontSize: "14px",
          boxShadow: "0 2px 5px rgba(0,0,0,0.3)",
          opacity: "0",
          transition: "transform 0.3s, opacity 0.3s",
          zIndex: "10000",
          pointerEvents: "none"
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
          toast.style.opacity = "1";
          toast.style.transform = "translateX(-50%) translateY(0)";
        });
        setTimeout(() => {
          toast.style.opacity = "0";
          toast.style.transform = "translateX(-50%) translateY(20px)";
          setTimeout(() => {
            toast.remove();
          }, 300);
        }, duration);
      }
      class SyntaxHighlighter {
        textarea;
        container;
        backdrop;
        debounceTimer = null;
        idleTimer = null;
        IDLE_DELAY = 2e3;
constructor(selector) {
          const input = document.querySelector(selector);
          if (!input) return;
          this.textarea = input;
          this.init();
        }
        init() {
          if (this.textarea.parentElement?.classList.contains("gh-container")) return;
          this.container = document.createElement("div");
          this.container.className = "gh-container";
          this.backdrop = document.createElement("div");
          this.backdrop.className = "gh-backdrop";
          const parent = this.textarea.parentElement;
          if (parent) {
            parent.insertBefore(this.container, this.textarea);
            this.container.appendChild(this.backdrop);
            this.container.appendChild(this.textarea);
          }
          this.injectStyles();
          this.syncStyles();
          this.textarea.addEventListener("input", () => {
            this.onInputDebounced();
            this.resetIdleTimer();
          });
          this.textarea.addEventListener("keyup", (e) => {
            this.onInputDebounced();
            this.resetIdleTimer(e);
          });
          this.textarea.addEventListener("change", () => {
            this.onInputDebounced();
            this.resetIdleTimer();
          });
          this.textarea.addEventListener("scroll", () => this.syncScroll());
          new ResizeObserver(() => this.syncStyles()).observe(this.textarea);
          this.textarea.addEventListener("focus", () => {
            this.resetIdleTimer();
          });
          this.textarea.addEventListener("mousedown", () => {
            this.resetIdleTimer();
          });
          this.textarea.addEventListener("blur", () => {
            this.activatePhantomMode();
          });
          this.update();
          this.resetIdleTimer();
        }
        injectStyles() {
          const computed = window.getComputedStyle(this.textarea);
          const style = document.createElement("style");
          style.textContent = `
            .gh-container {
                position: relative;
                width: 100%;
                margin: 0; padding: 0;
                background-color: ${computed.backgroundColor};
                border-radius: ${computed.borderRadius};
                overflow: hidden;
            }

            .gh-backdrop {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                z-index: 1;
                pointer-events: none;
                overflow: hidden; 
                white-space: pre-wrap;
                word-wrap: break-word;
                box-sizing: border-box;
                color: #333;
                opacity: 0; /* Hidden by default (Active Mode) */
                transition: none; /* Instant hide when value changes to 0 */
            }

            /* Phantom Mode: Backdrop Visible */
            .gh-backdrop.gh-visible {
                opacity: 1;
                transition: opacity 0.8s ease-in-out; /* Gradual fade-in */
            }

            textarea.gh-input {
                position: relative;
                z-index: 2;
                background-color: transparent !important;
                /* Default: Text Visible (Active Mode) */
                color: inherit; 
                /* Removed base transition to ensure instant Wake Up */
            }

            /* Phantom Mode: Text Transparent */
            textarea.gh-input.gh-ghost {
                color: transparent !important;
                caret-color: transparent !important; /* Hide cursor in Idle */
                transition: color 0.8s ease-in-out; /* Gradual fade-out to ghost */
            }

            textarea.gh-input.gh-ghost::selection {
                background-color: rgba(0, 117, 255, 0.3);
                color: transparent;
            }
        `;
          document.head.appendChild(style);
          this.textarea.classList.add("gh-input");
        }
        syncStyles() {
          const computed = window.getComputedStyle(this.textarea);
          const props = [
            "font-family",
            "font-size",
            "font-weight",
            "font-style",
            "font-stretch",
            "font-kerning",
            "font-variant-ligatures",
            "line-height",
            "letter-spacing",
            "text-transform",
            "text-indent",
            "text-rendering",
            "tab-size",
            "word-spacing",
            "padding-top",
            "padding-bottom",
            "padding-left",
            "border-width",
            "box-sizing"
          ];
          props.forEach((prop) => {
            this.backdrop.style.setProperty(prop, computed.getPropertyValue(prop));
          });
          this.container.style.marginTop = computed.marginTop;
          this.container.style.marginBottom = computed.marginBottom;
          this.container.style.marginLeft = computed.marginLeft;
          this.container.style.marginRight = computed.marginRight;
          this.textarea.style.margin = "0";
          this.backdrop.style.margin = "0";
          this.backdrop.style.textAlign = computed.textAlign;
          this.backdrop.style.whiteSpace = "pre-wrap";
          this.backdrop.style.wordBreak = "break-word";
          this.container.style.backgroundColor = computed.backgroundColor;
          const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
          const borderRight = parseFloat(computed.borderRightWidth) || 0;
          const padRight = parseFloat(computed.paddingRight) || 0;
          const scrollbarWidth = this.textarea.offsetWidth - this.textarea.clientWidth - borderLeft - borderRight;
          if (scrollbarWidth > 0) {
            this.backdrop.style.paddingRight = `${padRight + scrollbarWidth}px`;
          } else {
            this.backdrop.style.paddingRight = `${padRight}px`;
          }
          const isDark = detectDarkTheme();
          const textColor = isDark ? "#eee" : "#333";
          const caretColor = isDark ? "#fff" : "#000";
          this.backdrop.style.color = textColor;
          this.textarea.style.color = textColor;
          this.textarea.style.caretColor = caretColor;
        }
        syncScroll() {
          this.backdrop.scrollTop = this.textarea.scrollTop;
          this.backdrop.scrollLeft = this.textarea.scrollLeft;
        }
        onInputDebounced() {
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = window.setTimeout(() => {
            this.update();
            this.debounceTimer = null;
          }, 30);
        }
resetIdleTimer(e) {
          if (e) {
            if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;
          }
          this.textarea.classList.remove("gh-ghost");
          this.backdrop.classList.remove("gh-visible");
          if (this.idleTimer) clearTimeout(this.idleTimer);
          this.idleTimer = window.setTimeout(() => {
            this.activatePhantomMode();
          }, this.IDLE_DELAY);
        }
        activatePhantomMode() {
          this.update();
          this.textarea.classList.add("gh-ghost");
          this.backdrop.classList.add("gh-visible");
        }

update() {
          const text = this.textarea.value;
          const html = this.parseText(text);
          this.backdrop.innerHTML = text.endsWith("\n") ? html + " <br>" : html;
          this.syncScroll();
        }
        parseText(text) {
          const isDarkTheme = detectDarkTheme();
          let html = "";
          let i = 0;
          const len = text.length;
          const escapeHtml = (str) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          while (i < len) {
            const openIdx = text.indexOf("[", i);
            if (openIdx === -1) {
              html += escapeHtml(text.slice(i));
              break;
            }
            let nameStart = openIdx - 1;
            while (nameStart >= i && /\S/.test(text[nameStart]) && text[nameStart] !== "[") {
              nameStart--;
            }
            nameStart++;
            if (nameStart < openIdx && nameStart >= i) {
              html += escapeHtml(text.slice(i, nameStart));
              const name = text.slice(nameStart, openIdx);
              let depth = 1;
              let closeIdx = openIdx + 1;
              while (depth > 0 && closeIdx < len) {
                if (text[closeIdx] === "[") depth++;
                else if (text[closeIdx] === "]") depth--;
                if (depth > 0) closeIdx++;
              }
              if (depth === 0) {
                const contentValues = text.slice(openIdx + 1, closeIdx);
                const color = stringToColor(name, isDarkTheme);
                const style = `style="color: ${color}; font-weight: bold;"`;
                html += `<span ${style}>${escapeHtml(name)}</span>`;
                html += `<span ${style}>[</span>`;
                html += escapeHtml(contentValues);
                html += `<span ${style}>]</span>`;
                i = closeIdx + 1;
                continue;
              }
            }
            html += escapeHtml(text.slice(i, openIdx + 1));
            i = openIdx + 1;
          }
          return html;
        }
      }
      class SmartInputHandler {
        input = null;
        isBound = false;
        checkEnabled;
        isDeleting = false;
        isComposing = false;
        constructor(selector, checkEnabled) {
          this.checkEnabled = checkEnabled;
          this.input = document.querySelector(selector);
          if (this.input) {
            this.init();
          } else {
            console.warn(
              `SmartInputHandler: Element not found for selector "${selector}"`
            );
          }
        }
        init() {
          if (!this.input || this.isBound) return;
          document.addEventListener("keydown", (e) => this.onKeyDown(e), true);
          this.input.addEventListener(
            "keyup",
            () => {
              this.isDeleting = false;
            },
            true
          );
          this.input.addEventListener("compositionstart", () => {
            this.isComposing = true;
          });
          this.input.addEventListener("compositionend", () => {
            this.isComposing = false;
            this.handleInput(null);
          });
          this.input.addEventListener(
            "input",
            (e) => this.handleInput(e)
          );
          document.addEventListener(
            "selectionchange",
            () => this.onSelectionChange()
          );
          this.isBound = true;
        }
        onKeyDown(e) {
          if (!this.checkEnabled()) return;
          if (this.isComposing) return;
          if (e.key === "Backspace" || e.key === "Delete") {
            this.isDeleting = true;
          } else {
            this.isDeleting = false;
          }
          if (e.key === "Tab") {
            const cursor = this.input.selectionStart;
            const text = this.input.value;
            const charBefore = text[cursor - 1];
            const isTextBefore = charBefore && /\S/.test(charBefore) && charBefore !== "[";
            if (!isTextBefore) {
              const remaining = text.slice(cursor);
              const match = remaining.match(/^([ \t]*\][ \t]*)/);
              if (match) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                const matchedStr = match[1];
                const hasTrailingSpace = /[ \t]$/.test(matchedStr);
                const jumpOffset = matchedStr.length;
                setTimeout(() => {
                  if (!this.input) return;
                  this.input.focus();
                  const targetPos = cursor + jumpOffset;
                  this.input.setSelectionRange(targetPos, targetPos);
                  if (!hasTrailingSpace) {
                    this.insertText(" ", 1);
                  }
                }, 0);
              }
            }
          } else if (e.key === "[") {
            const cursor = this.input.selectionStart;
            const text = this.input.value;
            if (cursor > 0 && text[cursor - 1] === "\\") {
              return;
            }
            let balance = 0;
            for (let i = 0; i < cursor; i++) {
              if (text[i] === "[") balance++;
              else if (text[i] === "]") balance--;
            }
            if (balance > 0) return;
            const charBefore = text[cursor - 1];
            if (charBefore && /\S/.test(charBefore)) {
              let nameStart = cursor - 1;
              while (nameStart >= 0 && /\S/.test(text[nameStart]) && text[nameStart] !== "[") {
                nameStart--;
              }
              nameStart++;
              const candidateName = text.slice(nameStart, cursor);
              const escapedName = candidateName.replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
              );
              const regex = new RegExp(`(^|\\s)${escapedName}\\s*\\[`, "g");
              let match;
              while ((match = regex.exec(text)) !== null) {
                e.preventDefault();
                const groupStart = match.index + match[0].length;
                let depth = 1;
                let existingCloseIdx = groupStart;
                while (depth > 0 && existingCloseIdx < text.length) {
                  if (text[existingCloseIdx] === "[") depth++;
                  else if (text[existingCloseIdx] === "]") depth--;
                  if (depth > 0) existingCloseIdx++;
                }
                if (depth === 0) {
                  this.input.setSelectionRange(nameStart, cursor);
                  document.execCommand("delete");
                  const deletedLen = cursor - nameStart;
                  let jumpPos = existingCloseIdx;
                  if (existingCloseIdx > nameStart) {
                    jumpPos -= deletedLen;
                  }
                  const valAfterDelete = this.input.value;
                  let spaceCount = 0;
                  let k = jumpPos - 1;
                  while (k >= 0 && valAfterDelete[k] === " ") {
                    spaceCount++;
                    k--;
                  }
                  if (spaceCount < 2) {
                    const spacesToAdd = 2 - spaceCount;
                    const spaces = " ".repeat(spacesToAdd);
                    this.input.setSelectionRange(jumpPos, jumpPos);
                    document.execCommand("insertText", false, spaces);
                    jumpPos += spacesToAdd;
                  }
                  this.input.setSelectionRange(jumpPos - 1, jumpPos - 1);
                  this.input.blur();
                  this.input.focus();
                  return;
                }
              }
              e.preventDefault();
              this.insertText("[  ] ", 2);
            }
          } else if (e.key === "]") {
            const cursor = this.input.selectionStart;
            const text = this.input.value;
            if (text[cursor] === "]") {
              e.preventDefault();
              this.input.setSelectionRange(cursor + 1, cursor + 1);
            }
          }
        }
handleInput(e) {
          if (!this.checkEnabled()) return;
          if (this.isComposing) return;
          if (!this.input) return;
          if (this.isDeleting) return;
          if (e && e.inputType && e.inputType.startsWith("delete")) return;
          const cursor = this.input.selectionStart;
          const text = this.input.value;
          const charBefore = text[cursor - 1];
          const charAfter = text[cursor];
          let val = text;
          let newCursor = cursor;
          let needsUpdate = false;
          if (charBefore === "[") {
            if (charAfter !== " ") {
              val = text.slice(0, cursor) + " " + text.slice(cursor);
              newCursor = cursor + 1;
              needsUpdate = true;
            }
          } else if (charAfter === "]") {
            if (charBefore !== " ") {
              val = text.slice(0, cursor) + " " + text.slice(cursor);
              newCursor = cursor + 1;
              needsUpdate = true;
            }
          }
          if (needsUpdate) {
            this.input.value = val;
            this.input.setSelectionRange(newCursor, newCursor);
          }
        }
        onSelectionChange() {
          if (!this.checkEnabled()) return;
          if (!this.input || document.activeElement !== this.input) return;
          if (this.input.selectionStart !== this.input.selectionEnd) return;
          if (this.isDeleting) return;
          if (this.isComposing) return;
          const cursor = this.input.selectionStart;
          const text = this.input.value;
          const charBefore = text[cursor - 1];
          const charAfter = text[cursor];
          let newCursor = cursor;
          let needsMove = false;
          if (charBefore === "[") {
            if (charAfter === " ") {
              newCursor = cursor + 1;
              needsMove = true;
            }
          } else if (charAfter === "]") {
            const val = this.input.value;
            let k = cursor - 1;
            let spaceCount = 0;
            while (k >= 0 && val[k] === " ") {
              spaceCount++;
              k--;
            }
            if (spaceCount < 2) {
              const needed = 2 - spaceCount;
              const spaces = " ".repeat(needed);
              const success = document.execCommand("insertText", false, spaces);
              if (success) {
                const newPos = this.input.selectionStart - 1;
                this.input.setSelectionRange(newPos, newPos);
              }
            } else {
              if (charBefore === " ") {
                newCursor = cursor - 1;
                needsMove = true;
              }
            }
          }
          if (needsMove) {
            this.input.setSelectionRange(newCursor, newCursor);
          }
        }
        insertText(textToInsert, cursorOffset) {
          if (!this.input) return;
          const success = document.execCommand("insertText", false, textToInsert);
          if (!success) {
            const start = this.input.selectionStart;
            const end = this.input.selectionEnd;
            const text = this.input.value;
            this.input.value = text.substring(0, start) + textToInsert + text.substring(end);
            this.input.dispatchEvent(new Event("input", { bubbles: true }));
          }
          const newPos = this.input.selectionStart - (textToInsert.length - cursorOffset);
          this.input.setSelectionRange(newPos, newPos);
        }
      }
      const characterTagCache = {};
      async function sortGroupTags(groups, postId) {
        if (!postId) return;
        let characterTags = characterTagCache[postId];
        if (!characterTags) {
          try {
            const resp = await fetch(`/posts/${postId}.json`);
            if (resp.ok) {
              const data = await resp.json();
              const postData = data.post || data;
              const rawCharString = postData.tag_string_character || "";
              characterTags = new Set(
                (rawCharString.split(/\s+/) || []).map((t) => t.trim()).filter((t) => t.length > 0)
              );
              characterTagCache[postId] = characterTags;
            }
          } catch (e) {
            console.warn(
              "GroupingTags: Failed to fetch post data for sorting. Falling back to simple alpha sort.",
              e
            );
            characterTags = new Set();
          }
        }
        Object.keys(groups).forEach((gName) => {
          groups[gName].sort((a, b) => {
            const cleanA = a.trim();
            const cleanB = b.trim();
            const isCharA = characterTags?.has(cleanA) || false;
            const isCharB = characterTags?.has(cleanB) || false;
            if (isCharA && !isCharB) return -1;
            if (!isCharA && isCharB) return 1;
            return cleanA.localeCompare(cleanB);
          });
        });
      }
      const tagSorter = Object.freeze( Object.defineProperty({
        __proto__: null,
        sortGroupTags
      }, Symbol.toStringTag, { value: "Module" }));
      const parseGroupedTags = (text) => {
        const groups = {};
        const groupRanges = [];
        let i = 0;
        while (i < text.length) {
          const openBracketIndex = text.indexOf("[", i);
          if (openBracketIndex === -1) break;
          if (openBracketIndex > 0 && text[openBracketIndex - 1] === "\\") {
            i = openBracketIndex + 1;
            continue;
          }
          const beforeBracket = text.slice(0, openBracketIndex);
          const groupNameMatch = beforeBracket.match(/([a-zA-Z0-9_\-]+)\s*$/);
          if (!groupNameMatch) {
            i = openBracketIndex + 1;
            continue;
          }
          const groupName = groupNameMatch[1];
          const groupStartIndex = groupNameMatch.index;
          let depth = 1;
          let closeBracketIndex = -1;
          for (let j = openBracketIndex + 1; j < text.length; j++) {
            if (text[j] === "[" && text[j - 1] !== "\\") depth++;
            else if (text[j] === "]" && text[j - 1] !== "\\") depth--;
            if (depth === 0) {
              closeBracketIndex = j;
              break;
            }
          }
          if (closeBracketIndex !== -1) {
            const content = text.slice(openBracketIndex + 1, closeBracketIndex);
            const rawTags = content.split(/\s+/).filter((t) => t.length > 0);
            const tags = rawTags.map(
              (t) => t.replace(/\\\[/g, "[").replace(/\\\]/g, "]")
            );
            if (groups[groupName]) {
              groups[groupName] = Array.from(
new Set([...groups[groupName], ...tags])
              );
            } else {
              groups[groupName] = tags;
            }
            groupRanges.push({ start: groupStartIndex, end: closeBracketIndex + 1 });
            i = closeBracketIndex + 1;
          } else {
            i = openBracketIndex + 1;
          }
        }
        let looseText = "";
        let cursor = 0;
        groupRanges.sort((a, b) => a.start - b.start);
        for (const range of groupRanges) {
          looseText += text.slice(cursor, range.start) + " ";
          cursor = range.end;
        }
        looseText += text.slice(cursor);
        const originalTags = looseText.split(/\s+/).filter((t) => t.length > 0).map((t) => t.replace(/\\\[/g, "[").replace(/\\\]/g, "]"));
        return { groups, originalTags };
      };
      const flattenTags = (text) => {
        const { groups, originalTags } = parseGroupedTags(text);
        const groupTags = Object.values(groups).flat();
        const result = Array.from( new Set([...groupTags, ...originalTags])).join(" ");
        return result.length > 0 ? result + " " : result;
      };
      const reconstructTags = (currentText, groupData) => {
        const flatText = flattenTags(currentText);
        const allCurrentTags = flatText.split(/\s+/).filter((t) => t.length > 0);
        const usedTags = new Set();
        const formedGroups = [];
        for (const [groupName, groupTags] of Object.entries(groupData)) {
          new Set(groupTags);
          const presentTags = groupTags.filter((tag) => {
            return allCurrentTags.includes(tag);
          });
          if (presentTags.length > 0) {
            formedGroups.push(`${groupName}[ ${presentTags.join(" ")} ] `);
            presentTags.forEach((t) => usedTags.add(t));
          }
        }
        const looseTags = allCurrentTags.filter((t) => !usedTags.has(t));
        const escapedLooseTags = looseTags.map(
          (t) => t.replace(/\[/g, "\\[").replace(/\]/g, "\\]")
        );
        const looseString = escapedLooseTags.join(" ");
        const groupString = formedGroups.join("\n\n");
        if (looseString && groupString) {
          return `${looseString}

${groupString}`;
        } else {
          return looseString + groupString;
        }
      };
      const removeMissingTagsFromGroups = (groups, currentTags) => {
        const currentTagSet = new Set(currentTags);
        const updatedGroups = {};
        let changed = false;
        for (const [groupName, tags] of Object.entries(groups)) {
          const newTags = tags.filter((tag) => currentTagSet.has(tag));
          if (newTags.length !== tags.length) {
            changed = true;
          }
          if (newTags.length > 0) {
            updatedGroups[groupName] = newTags;
          } else {
            changed = true;
          }
        }
        return { updatedGroups, changed };
      };
      class SidebarInjector {
        checkEnabled;
        constructor(checkEnabled) {
          this.checkEnabled = checkEnabled;
          this.injectStyles();
          this.init();
        }
        injectStyles() {
          const style = document.createElement("style");
          style.textContent = `
            .grouping-tags-indicator {
                display: block;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                /* Absolute Positioning */
                position: absolute;
                left: 0;
                top: 50%;
                transform: translateY(-50%);
                margin: 0;
                
                box-sizing: border-box;
                border: 1px solid rgba(0,0,0,0.2);
                cursor: pointer;
            }

            /* Stacked Loop for Multi-Group - Simplified to Single Circle with Diagonal Shadow */
            .grouping-tags-indicator.gt-multi {
                /* Color handled by JS (White/Black) */
                box-shadow: 2px -2px 0 rgba(0,0,0,0.2);
                /* Inherit default margins/sizing */
                z-index: 10;
            }

            /* Ghost Mode for Ungrouped Tags - Invisible default */
            .grouping-tags-indicator.gt-ghost {
                background-color: transparent;
                border: 1px solid transparent; /* Hidden border */
                box-shadow: none; /* No shadow */
                opacity: 0;
                transition: opacity 0.2s ease-in-out, border-color 0.2s;
            }
            
            /* Show on hover of the list item */
            li:hover .grouping-tags-indicator.gt-ghost {
                opacity: 1;
                border-color: rgba(150, 150, 150, 0.5);
                box-shadow: inset 0 0 4px rgba(0,0,0,0.1);
            }
        `;
          document.head.appendChild(style);
        }
        allGroups = {};
        async init() {
          if (!this.checkEnabled()) return;
          const postId = getPostId();
          if (!postId) return;
          try {
            const data = await getPostTagData(postId);
            this.allGroups = data && data.groups ? data.groups : {};
            this.injectIndicators(this.allGroups);
          } catch (e) {
            console.error("GroupingTags: Failed to load sidebar data", e);
          }
        }
        injectIndicators(groups) {
          const tagToGroups = {};
          for (const [groupName, tags2] of Object.entries(groups)) {
            tags2.forEach((tag) => {
              if (!tagToGroups[tag]) tagToGroups[tag] = [];
              tagToGroups[tag].push(groupName);
            });
          }
          document.querySelectorAll(
            "#tag-list ul li, #sidebar ul li"
          );
          document.querySelectorAll("#tag-list ul, #sidebar ul");
          const tagListContainer = document.querySelector("#tag-list");
          if (tagListContainer && !document.querySelector(".grouping-tags-view-switch")) {
            const switchContainer = document.createElement("div");
            switchContainer.className = "grouping-tags-view-switch";
            Object.assign(switchContainer.style, {
              marginBottom: "10px",
              marginTop: "5px",
              display: "flex",
              alignItems: "center",
              gap: "5px"
            });
            const select = document.createElement("select");
            Object.assign(select.style, {
              width: "auto",
minWidth: "80px",
              padding: "2px 4px",
              borderRadius: "4px",
              border: "1px solid #ccc",
              backgroundColor: detectDarkTheme() ? "#333" : "#fff",
              color: detectDarkTheme() ? "#fff" : "#000",
              fontSize: "14px",
height: "24px"
});
            const optDefault = document.createElement("option");
            optDefault.value = "default";
            optDefault.textContent = "View: Default";
            const optGroups = document.createElement("option");
            optGroups.value = "groups";
            optGroups.textContent = "View: Groups";
            select.appendChild(optDefault);
            select.appendChild(optGroups);
            select.addEventListener("change", () => {
              const mode = select.value;
              if (mode === "groups") {
                this.renderGroupView(groups);
              } else {
                this.renderDefaultView();
              }
            });
            switchContainer.appendChild(select);
            const settingsBtn = document.createElement("div");
            settingsBtn.innerHTML = "☁️";
            Object.assign(settingsBtn.style, {
              cursor: "pointer",
              fontSize: "16px",
              padding: "2px 4px",
              marginLeft: "4px",
              userSelect: "none"
            });
            settingsBtn.title = "Data Sync & Import";
            settingsBtn.onclick = async () => {
              const { AuthManager: AuthManager2 } = await __vitePreload(async () => {
                const { AuthManager: AuthManager3 } = await Promise.resolve().then(() => auth);
                return { AuthManager: AuthManager3 };
              }, void 0 );
              const token = await AuthManager2.getToken(true);
              const openSettings = async () => {
                const { initializeGist } = await __vitePreload(async () => {
                  const { initializeGist: initializeGist2 } = await module.import('./gist-init-C__mfkh8-B0qIP166.js');
                  return { initializeGist: initializeGist2 };
                }, void 0 );
                await initializeGist();
                const { SettingsPanel } = await __vitePreload(async () => {
                  const { SettingsPanel: SettingsPanel2 } = await module.import('./settings-panel-CTInzcqt-DgSbreep.js');
                  return { SettingsPanel: SettingsPanel2 };
                }, void 0 );
                SettingsPanel.show();
              };
              if (!token) {
                const { LoginModal } = await __vitePreload(async () => {
                  const { LoginModal: LoginModal2 } = await module.import('./login-modal-DWnGxy6T-CHz_dOuL.js');
                  return { LoginModal: LoginModal2 };
                }, void 0 );
                LoginModal.show(async () => {
                  await openSettings();
                });
              } else {
                await openSettings();
              }
            };
            switchContainer.appendChild(settingsBtn);
            if (tagListContainer.firstChild) {
              tagListContainer.insertBefore(
                switchContainer,
                tagListContainer.firstChild
              );
            } else {
              tagListContainer.appendChild(switchContainer);
            }
          }
          const tags = document.querySelectorAll("li[data-tag-name]");
          tags.forEach((li) => {
            const tagName = li.getAttribute("data-tag-name");
            if (!tagName) return;
            if (li.classList.contains("tag-type-1") || li.classList.contains("tag-type-3") || li.classList.contains("tag-type-5")) {
              return;
            }
            const myGroups = tagToGroups[tagName] || [];
            const liEl = li;
            liEl.style.position = "relative";
            if (!liEl.style.paddingLeft || parseInt(liEl.style.paddingLeft) < 20) {
              liEl.style.paddingLeft = "20px";
            }
            this.createButton(liEl, myGroups);
          });
          window._groupingTagsLastGroups = groups;
          const currentSelect = document.querySelector(
            ".grouping-tags-view-switch select"
          );
          if (currentSelect && currentSelect.value === "groups") {
            this.renderGroupView(groups);
          }
        }
        originalParents = new Map();
renderDefaultView() {
          const customContainer = document.getElementById(
            "grouping-tags-custom-list"
          );
          if (customContainer) customContainer.style.display = "none";
          this.originalParents.forEach((info, li) => {
            if (info.parent) {
              info.parent.insertBefore(li, info.nextSibling);
            }
          });
          this.originalParents.clear();
          const listsToRestore = document.querySelectorAll(
            ".character-tag-list, .general-tag-list"
          );
          listsToRestore.forEach((el) => el.style.display = "");
          const allHeaders = document.querySelectorAll(
            "#tag-list h1, #tag-list h2, #tag-list h3"
          );
          allHeaders.forEach((el) => el.style.display = "");
        }
        renderGroupView(groups) {
          this.renderDefaultView();
          const customContainer = document.getElementById(
            "grouping-tags-custom-list"
          );
          if (customContainer) {
            customContainer.innerHTML = "";
            customContainer.style.display = "block";
          } else {
            const c = document.createElement("div");
            c.id = "grouping-tags-custom-list";
            const targets = document.querySelectorAll(
              ".character-tag-list, .general-tag-list"
            );
            let insertRef = null;
            if (targets.length > 0) {
              const firstList = targets[0];
              const header = firstList.previousElementSibling;
              if (header && (header.tagName === "H1" || header.tagName === "H2" || header.tagName === "H3")) {
                insertRef = header;
              } else {
                insertRef = firstList;
              }
            }
            const tagList = document.querySelector("#tag-list");
            if (insertRef && insertRef.parentNode) {
              insertRef.parentNode.insertBefore(c, insertRef);
            } else if (tagList) {
              tagList.appendChild(c);
            }
          }
          const container = document.getElementById("grouping-tags-custom-list");
          const isDark = detectDarkTheme();
          const allTags = new Set();
          const processedTagsInRender = new Set();
          const moveOrCloneLi = (tag, targetUl, groupNames) => {
            const originalLi = document.querySelector(
              `li[data-tag-name="${CSS.escape(tag)}"]`
            );
            if (originalLi) {
              if (!originalLi.classList.contains("tag-type-0") && !originalLi.classList.contains("tag-type-4")) {
                return false;
              }
              if (!processedTagsInRender.has(tag)) {
                if (!this.originalParents.has(originalLi)) {
                  this.originalParents.set(originalLi, {
                    parent: originalLi.parentElement,
                    nextSibling: originalLi.nextSibling
                  });
                }
                targetUl.appendChild(originalLi);
                processedTagsInRender.add(tag);
                return true;
              } else {
                const clone = originalLi.cloneNode(true);
                const oldBtn = clone.querySelector(".grouping-tags-indicator");
                if (oldBtn) oldBtn.remove();
                const myGroups = [];
                for (const [g, tList] of Object.entries(groups)) {
                  if (tList.includes(tag)) myGroups.push(g);
                }
                this.createButton(clone, myGroups);
                targetUl.appendChild(clone);
                return true;
              }
            }
            return false;
          };
          const sortedGroups = Object.keys(groups).sort();
          sortedGroups.forEach((gName) => {
            const tags = groups[gName];
            const header = document.createElement("h3");
            header.textContent = gName;
            header.style.color = stringToColor(gName, isDark);
            header.style.marginBottom = "2px";
            header.style.marginTop = "10px";
            header.style.borderBottom = `1px solid ${stringToColor(gName, isDark)}`;
            const ul = document.createElement("ul");
            ul.className = "general-tag-list";
            let count = 0;
            tags.forEach((tag) => {
              allTags.add(tag);
              if (moveOrCloneLi(tag, ul)) count++;
            });
            if (count > 0) {
              container.appendChild(header);
              container.appendChild(ul);
            }
          });
          const ungroupedHeader = document.createElement("h3");
          ungroupedHeader.textContent = "Ungrouped";
          ungroupedHeader.style.color = isDark ? "#aaa" : "#555";
          ungroupedHeader.style.marginBottom = "2px";
          ungroupedHeader.style.marginTop = "10px";
          ungroupedHeader.style.borderBottom = "1px solid #777";
          const ulUngrouped = document.createElement("ul");
          ulUngrouped.className = "general-tag-list";
          let ungroupedCount = 0;
          const allLis = document.querySelectorAll("li[data-tag-name]");
          allLis.forEach((li) => {
            const tagName = li.getAttribute("data-tag-name");
            if (tagName && !allTags.has(tagName)) {
              if (moveOrCloneLi(tagName, ulUngrouped)) ungroupedCount++;
            }
          });
          if (ungroupedCount > 0) {
            container.appendChild(ungroupedHeader);
            container.appendChild(ulUngrouped);
          }
          const specificLists = document.querySelectorAll(
            "#tag-list > .character-tag-list, #tag-list > .general-tag-list"
          );
          specificLists.forEach((ul) => {
            ul.style.display = "none";
            const prev = ul.previousElementSibling;
            if (prev && (prev.tagName === "H1" || prev.tagName === "H2" || prev.tagName === "H3")) {
              if (!prev.classList.contains("grouping-tags-view-switch")) {
                prev.style.display = "none";
              }
            }
          });
          const allHeaders = document.querySelectorAll(
            "#tag-list h1, #tag-list h2, #tag-list h3"
          );
          allHeaders.forEach((h) => {
            if (container && container.contains(h)) return;
            const text = h.textContent?.trim().toLowerCase();
            if (text === "characters" || text === "general") {
              h.style.display = "none";
            }
          });
        }
        createButton(li, groupNames) {
          const existing = li.querySelector(".grouping-tags-indicator");
          if (existing) {
            existing.remove();
          }
          let targetLink = li.querySelector("a.wiki-link");
          if (!targetLink) {
            const searchTag = li.querySelector("a.search-tag");
            if (searchTag && searchTag.previousElementSibling && searchTag.previousElementSibling.tagName === "A") {
              targetLink = searchTag.previousElementSibling;
            }
          }
          if (!targetLink) {
            targetLink = li.querySelector("a.search-tag");
          }
          if (!targetLink) return;
          const btn = document.createElement("span");
          btn.className = "grouping-tags-indicator";
          const count = groupNames.length;
          const isMulti = count > 1;
          const isDark = detectDarkTheme();
          if (count === 0) {
            btn.classList.add("gt-ghost");
            btn.title = "No Group (Click to add?)";
          } else if (isMulti) {
            btn.classList.add("gt-multi");
            btn.title = `Groups: ${groupNames.join(", ")}`;
            btn.style.backgroundColor = isDark ? "#fff" : "#000";
          } else {
            const color = stringToColor(groupNames[0], isDark);
            btn.style.backgroundColor = color;
            btn.title = `Group: ${groupNames[0]}`;
            btn.classList.add("gt-single");
          }
          li.insertBefore(btn, li.firstChild);
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tagName = li.getAttribute("data-tag-name");
            if (tagName) {
              this.toggleGroupMenu(btn, tagName);
            }
          });
        }
        toggleGroupMenu(btn, tagName) {
          const existingMenu = document.querySelector(".grouping-tags-menu");
          if (existingMenu) {
            existingMenu.remove();
            if (existingMenu._triggerBtn === btn) return;
          }
          const isDark = detectDarkTheme();
          const menu = document.createElement("div");
          menu.className = "grouping-tags-menu";
          menu._triggerBtn = btn;
          const selectedGroups = new Set();
          Object.keys(this.allGroups).forEach((gName) => {
            if (this.allGroups[gName].includes(tagName)) {
              selectedGroups.add(gName);
            }
          });
          const saveAndClose = async () => {
            document.removeEventListener("click", outsideClickListener);
            let changed = false;
            Object.keys(this.allGroups).forEach((gName) => {
              const isSelected = selectedGroups.has(gName);
              const wasSelected = this.allGroups[gName].includes(tagName);
              if (isSelected && !wasSelected) {
                this.allGroups[gName].push(tagName);
                changed = true;
              } else if (!isSelected && wasSelected) {
                this.allGroups[gName] = this.allGroups[gName].filter(
                  (t) => t !== tagName
                );
                changed = true;
              }
            });
            if (changed) {
              const postId = getPostId();
              if (postId) {
                const { sortGroupTags: sortGroupTags2 } = await __vitePreload(async () => {
                  const { sortGroupTags: sortGroupTags3 } = await Promise.resolve().then(() => tagSorter);
                  return { sortGroupTags: sortGroupTags3 };
                }, void 0 );
                await sortGroupTags2(this.allGroups, postId);
                await savePostTagData({
                  postId,
                  updatedAt: Date.now(),
                  isImported: false,
                  groups: this.allGroups
                });
              }
              this.injectIndicators(this.allGroups);
              window.dispatchEvent(new CustomEvent("grouping-tags-db-update"));
            }
            menu.style.opacity = "0";
            menu.style.transform = "scaleY(0)";
            setTimeout(() => {
              menu.remove();
            }, 300);
          };
          const outsideClickListener = (e) => {
            if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
              saveAndClose();
            }
          };
          setTimeout(
            () => document.addEventListener("click", outsideClickListener),
            0
          );
          Object.assign(menu.style, {
            position: "absolute",
            zIndex: "1000",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            backgroundColor: isDark ? "#222" : "#eee",
            borderRadius: "10px",
            padding: "4px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
            border: `1px solid ${isDark ? "#444" : "#ccc"}`,

overflow: "visible",
opacity: "0",
            transform: "scaleY(0)",
            transformOrigin: "top center",
transition: "opacity 0.3s ease, transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)"
          });
          requestAnimationFrame(() => {
            menu.style.opacity = "1";
            menu.style.transform = "scaleY(1)";
          });
          const collapseBtn = document.createElement("div");
          collapseBtn.textContent = "⌃";
          collapseBtn.title = "Save & Close";
          Object.assign(collapseBtn.style, {
            cursor: "pointer",
            fontSize: "12px",
            marginBottom: "4px",
            color: isDark ? "#ccc" : "#555",
            userSelect: "none",
            lineHeight: "1",
            textAlign: "center",
            width: "100%"
          });
          collapseBtn.onclick = (e) => {
            e.stopPropagation();
            saveAndClose();
          };
          menu.appendChild(collapseBtn);
          const allGroupNames = Object.keys(this.allGroups).sort();
          const shouldScroll = allGroupNames.length > 5;
          const listContainer = document.createElement("div");
          Object.assign(listContainer.style, {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%"
          });
          if (shouldScroll) {
            Object.assign(listContainer.style, {
maxHeight: "104px",
              overflowY: "auto",
              overflowX: "hidden",
scrollbarWidth: "none",
msOverflowStyle: "none"
});
            listContainer.classList.add("grouping-tags-scroll-container");
            if (!document.querySelector("#grouping-tags-scroll-style")) {
              const s = document.createElement("style");
              s.id = "grouping-tags-scroll-style";
              s.textContent = `
                    .grouping-tags-scroll-container::-webkit-scrollbar {
                        width: 0px;
                        background: transparent;
                    }
                `;
              document.head.appendChild(s);
            }
          }
          allGroupNames.forEach((gName) => {
            const wrapper = document.createElement("div");
            wrapper.style.position = "relative";
            const circle = document.createElement("div");
            const color = stringToColor(gName, isDark);
            const updateCircleStyle = () => {
              const isActive = selectedGroups.has(gName);
              Object.assign(circle.style, {
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                marginBottom: "4px",
                cursor: "pointer",
                backgroundColor: isActive ? color : "transparent",
                border: `2px solid ${color}`,
boxSizing: "border-box",
                transition: "transform 0.1s, background-color 0.2s",
                transform: isActive ? "scale(1.1)" : "scale(1)",
                flexShrink: "0"
});
            };
            updateCircleStyle();
            const label = document.createElement("div");
            label.textContent = gName;
            Object.assign(label.style, {
              position: "absolute",
              left: "24px",
top: "50%",
              transform: "translateY(-50%)",
              backgroundColor: isDark ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.9)",
              color: isDark ? "#fff" : "#000",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "11px",
              whiteSpace: "nowrap",
              pointerEvents: "none",
opacity: "0",
              transition: "opacity 0.1s",
              boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
              zIndex: "1001",
              border: `1px solid ${isDark ? "#555" : "#ddd"}`
            });
            circle.onmouseenter = () => {
              label.style.opacity = "1";
            };
            circle.onmouseleave = () => {
              label.style.opacity = "0";
            };
            circle.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (selectedGroups.has(gName)) {
                selectedGroups.delete(gName);
              } else {
                selectedGroups.add(gName);
              }
              updateCircleStyle();
            };
            wrapper.appendChild(circle);
            wrapper.appendChild(label);
            listContainer.appendChild(wrapper);
          });
          menu.appendChild(listContainer);
          const addWrapper = document.createElement("div");
          addWrapper.style.position = "relative";
          const addBtn = document.createElement("div");
          addBtn.textContent = "+";
          Object.assign(addBtn.style, {
            width: "16px",
            height: "16px",
            borderRadius: "50%",
cursor: "pointer",
            backgroundColor: "transparent",
            border: `2px solid ${isDark ? "#555" : "#aaa"}`,
            color: isDark ? "#ccc" : "#555",
            boxSizing: "border-box",
display: "flex",
            justifyContent: "center",
            alignItems: "center",

fontSize: "14px",
            fontWeight: "bold",
            transition: "background-color 0.2s, color 0.2s"
          });
          const addLabel = document.createElement("div");
          addLabel.textContent = "New Group";
          Object.assign(addLabel.style, {
            position: "absolute",
            left: "24px",
            top: "50%",
            transform: "translateY(-50%)",
            backgroundColor: isDark ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.9)",
            color: isDark ? "#fff" : "#000",
            padding: "2px 6px",
            borderRadius: "4px",
            fontSize: "11px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            opacity: "0",
            transition: "opacity 0.1s",
            boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
            zIndex: "1001",
            border: `1px solid ${isDark ? "#555" : "#ddd"}`
          });
          addBtn.onmouseenter = () => {
            if (addLabel.tagName === "DIV") addLabel.style.opacity = "1";
          };
          addBtn.onmouseleave = () => {
            if (addLabel.tagName === "DIV") addLabel.style.opacity = "0";
          };
          addBtn.onclick = (e) => {
            e.stopPropagation();
            addBtn.style.display = "none";
            const input = document.createElement("input");
            Object.assign(input.style, {
              position: "absolute",
left: "24px",
              top: "50%",
              transform: "translateY(-50%)",
              width: "100px",
              fontSize: "11px",
              padding: "2px",
              borderRadius: "4px",
              border: `1px solid ${isDark ? "#888" : "#ccc"}`,
              backgroundColor: isDark ? "#333" : "#fff",
              color: isDark ? "#fff" : "#000",
              zIndex: "1002"
            });
            addBtn.style.display = "block";
            addBtn.textContent = "";
            addBtn.style.border = "2px solid transparent";
            const updatePreview = () => {
              const val = input.value.trim();
              const color = val ? stringToColor(val, isDark) : isDark ? "#555" : "#aaa";
              addBtn.style.backgroundColor = val ? color : "transparent";
              addBtn.style.border = `2px solid ${val ? color : isDark ? "#555" : "#aaa"}`;
            };
            input.oninput = updatePreview;
            input.onkeydown = async (ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                ev.stopPropagation();
                const newName = input.value.trim();
                if (newName) {
                  if (!/^[a-zA-Z0-9_\-]+$/.test(newName)) {
                    showToast$1(
                      "Invalid Name: Spaces are not allowed. Use '_' instead.",
                      "error"
                    );
                    input.style.borderColor = "#d32f2f";
                    setTimeout(() => {
                      input.style.borderColor = isDark ? "#888" : "#ccc";
                    }, 500);
                    return;
                  }
                  if (!this.allGroups[newName]) {
                    this.allGroups[newName] = [];
                  }
                  selectedGroups.add(newName);
                  await saveAndClose();
                }
              } else if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                if (input.parentNode === addWrapper) {
                  addWrapper.replaceChild(addLabel, input);
                }
                addBtn.textContent = "+";
                addBtn.style.backgroundColor = "transparent";
                addBtn.style.border = `2px solid ${isDark ? "#555" : "#aaa"}`;
                addBtn.style.display = "flex";
              }
            };
            input.onclick = (ev) => ev.stopPropagation();
            addWrapper.replaceChild(input, addLabel);
            input.focus();
          };
          addWrapper.appendChild(addBtn);
          addWrapper.appendChild(addLabel);
          menu.appendChild(addWrapper);
          const rect = btn.getBoundingClientRect();
          document.body.appendChild(menu);
          const scrollX = window.pageXOffset;
          const scrollY = window.pageYOffset;
          menu.style.left = `${rect.left + scrollX - 2}px`;
          menu.style.top = `${rect.top + scrollY - 2}px`;
          menu.style.width = "20px";
        }
syncTimeout = null;
        async triggerAutoSync(postId) {
          if (this.syncTimeout) clearTimeout(this.syncTimeout);
          this.syncTimeout = setTimeout(async () => {
            const { SyncManager: SyncManager2 } = await __vitePreload(async () => {
              const { SyncManager: SyncManager3 } = await Promise.resolve().then(() => syncManager);
              return { SyncManager: SyncManager3 };
            }, void 0 );
            const { getLocalDataByShard: getLocalDataByShard2 } = await __vitePreload(async () => {
              const { getLocalDataByShard: getLocalDataByShard3 } = await Promise.resolve().then(() => db);
              return { getLocalDataByShard: getLocalDataByShard3 };
            }, void 0 );
            try {
              const shardIdx = SyncManager2.getShardIndex(postId);
              const localData = await getLocalDataByShard2(shardIdx);
              await SyncManager2.syncShard(shardIdx, localData);
            } catch (e) {
              console.error("❌ Auto-Sync Failed:", e);
            }
          }, 3e3);
        }
      }
      const STORAGE_KEY_ENABLED = "grouping_tags_enabled";
      function isScriptEnabled() {
        const checkbox = document.querySelector(
          ".grouping-tags-switch input"
        );
        if (checkbox) {
          return checkbox.checked;
        }
        return _GM_getValue(STORAGE_KEY_ENABLED, false);
      }
      function setScriptEnabled(enabled) {
        _GM_setValue(STORAGE_KEY_ENABLED, enabled);
      }
      function parseToggleStyle() {
        const style = document.createElement("style");
        style.textContent = `
    .grouping-tags-toggle-container {
      margin-left: 20px;
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
    }
    .grouping-tags-label {
      margin-right: 8px;
      font-weight: bold;
    }
    .grouping-tags-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 20px;
    }
    .grouping-tags-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .grouping-tags-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: .4s;
      border-radius: 20px;
    }
    .grouping-tags-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 2px;
      bottom: 2px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }
    input:checked + .grouping-tags-slider {
      background-color: #0075ff;
    }
    input:focus + .grouping-tags-slider {
      box-shadow: 0 0 1px #2196F3;
    }
    input:checked + .grouping-tags-slider:before {
      transform: translateX(20px);
    }
  `;
        document.head.appendChild(style);
      }
      function showToast(message, duration = 3e3) {
        const toast = document.createElement("div");
        toast.textContent = message;
        Object.assign(toast.style, {
          position: "fixed",
          bottom: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(255, 0, 0, 0.8)",
          color: "white",
          padding: "10px 20px",
          borderRadius: "5px",
          zIndex: "10000",
          fontSize: "14px",
          boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
          transition: "opacity 0.3s"
        });
        document.body.appendChild(toast);
        setTimeout(() => {
          toast.style.opacity = "0";
          setTimeout(() => toast.remove(), 300);
        }, duration);
      }
      async function loadAndRestoreTags() {
        if (!isScriptEnabled()) return;
        const postId = getPostId();
        if (!postId) return;
        const input = document.querySelector(
          "#post_tag_string, #upload_tag_string"
        );
        if (!input) return;
        try {
          const data = await getPostTagData(postId);
          if (data && data.groups) {
            const currentText = input.value;
            const newText = reconstructTags(currentText, data.groups);
            if (currentText !== newText) {
              input.value = newText;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
        } catch (e) {
          console.error("GroupingTags: Failed to load/restore tags", e);
        }
      }
      function setupDynamicFormObserver() {
        const observer = new MutationObserver((mutations) => {
          let shouldRestore = false;
          for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
              for (const node of Array.from(mutation.addedNodes)) {
                if (node instanceof HTMLElement) {
                  if (node.matches && (node.matches("#post_tag_string, #upload_tag_string") || node.querySelector("#post_tag_string, #upload_tag_string"))) {
                    shouldRestore = true;
                    break;
                  }
                }
              }
            }
            if (shouldRestore) break;
          }
          if (shouldRestore) {
            setTimeout(() => {
              loadAndRestoreTags();
            }, 100);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
      function createToggleSwitch() {
        const container = document.createElement("span");
        container.className = "grouping-tags-toggle-container";
        const label = document.createElement("label");
        label.className = "grouping-tags-label";
        label.textContent = "Grouping Tags:";
        const switchLabel = document.createElement("label");
        switchLabel.className = "grouping-tags-switch";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        const isUploadPage = window.location.pathname.startsWith("/uploads");
        if (isUploadPage) {
          checkbox.checked = false;
        } else {
          checkbox.checked = _GM_getValue(STORAGE_KEY_ENABLED, false);
        }
        checkbox.addEventListener("change", () => {
          setScriptEnabled(checkbox.checked);
          if (checkbox.checked) {
            loadAndRestoreTags();
          } else {
            const input = document.querySelector(
              "#post_tag_string, #upload_tag_string"
            );
            if (input) {
              const currentText = input.value;
              if (/([^\s\[]+)\[\s*(.+?)\s*\]/.test(currentText)) {
                input.value = flattenTags(currentText);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          }
        });
        const slider = document.createElement("span");
        slider.className = "grouping-tags-slider";
        switchLabel.appendChild(checkbox);
        switchLabel.appendChild(slider);
        container.appendChild(label);
        container.appendChild(switchLabel);
        return container;
      }
      function insertToggleButton() {
        parseToggleStyle();
        const labels = Array.from(document.querySelectorAll("label"));
        const ratingLabel = labels.find((l) => l.innerText.includes("Rating"));
        if (ratingLabel && ratingLabel.parentElement) {
          const parent = ratingLabel.parentElement;
          parent.appendChild(createToggleSwitch());
        }
      }
      function setupFormInterception() {
        let isSubmitting = false;
        document.addEventListener(
          "submit",
          async (e) => {
            if (isSubmitting) return;
            const target = e.target;
            if (!target) return;
            const input = target.querySelector(
              "#post_tag_string, #upload_tag_string"
            );
            if (!input) return;
            const form = target;
            const text = input.value;
            e.preventDefault();
            e.stopImmediatePropagation();
            isSubmitting = true;
            if (e.submitter && e.submitter instanceof HTMLInputElement) {
              e.submitter.disabled = true;
            } else {
              const submitBtn = form.querySelector(
                'input[type="submit"]'
              );
              if (submitBtn) {
                submitBtn.disabled = true;
              }
            }
            try {
              const postId = getPostId();
              const enabled = isScriptEnabled();
              if (enabled) {
                const parsed = parseGroupedTags(text);
                if (postId && Object.keys(parsed.groups).length > 0) {
                  try {
                    await sortGroupTags(parsed.groups, postId);
                    const resp = await fetch(`/posts/${postId}.json`);
                    if (resp.ok) {
                      const data = await resp.json();
                      const postData = data.post || data;
                      const restrictedTags = new Set([
                        ...postData.tag_string_artist?.split(" ") || [],
                        ...postData.tag_string_copyright?.split(" ") || [],
                        ...postData.tag_string_meta?.split(" ") || []
                      ]);
                      const invalidTags = [];
                      Object.values(parsed.groups).forEach((tags) => {
                        tags.forEach((tag) => {
                          if (restrictedTags.has(tag)) {
                            invalidTags.push(tag);
                          }
                        });
                      });
                      if (invalidTags.length > 0) {
                        const msg = `Error: Cannot group Artist/Copyright/Meta tags: ${invalidTags.slice(0, 3).join(", ")}${invalidTags.length > 3 ? "..." : ""}`;
                        showToast(msg, 5e3);
                        isSubmitting = false;
                        if (e.submitter && e.submitter instanceof HTMLInputElement) {
                          e.submitter.disabled = false;
                        } else {
                          const submitBtn = form.querySelector(
                            'input[type="submit"]'
                          );
                          if (submitBtn) submitBtn.disabled = false;
                        }
                        return;
                      }
                    }
                  } catch (validationErr) {
                    console.warn(
                      "GroupingTags: Validation/Sorting fetch failed.",
                      validationErr
                    );
                  }
                }
                if (postId) {
                  try {
                    if (Object.keys(parsed.groups).length > 0) {
                      let isImportedState = false;
                      try {
                        const existingData = await getPostTagData(postId);
                        if (existingData) {
                          const isSame = JSON.stringify(existingData.groups) === JSON.stringify(parsed.groups);
                          if (isSame) {
                            isImportedState = existingData.isImported || false;
                          }
                        }
                      } catch (e2) {
                        console.warn(
                          "GroupingTags: Failed to check existing data for smart save",
                          e2
                        );
                      }
                      await savePostTagData({
                        postId,
                        updatedAt: Date.now(),
                        isImported: isImportedState,
                        groups: parsed.groups
                      });
                    } else {
                      const existing = await getPostTagData(postId);
                      if (existing) {
                        await deletePostTagData(postId);
                      }
                    }
                  } catch (err) {
                    console.error("GroupingTags: DB Operation Failed", err);
                  }
                }
                const allTags = [
                  ...Object.values(parsed.groups).flat(),
                  ...parsed.originalTags
                ];
                input.value = allTags.join(" ") + " ";
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
              } else {
                if (postId) {
                  try {
                    const dbData = await getPostTagData(postId);
                    if (dbData && dbData.groups) {
                      const currentTags = text.split(/\s+/).filter((t) => t.length > 0);
                      const { updatedGroups, changed } = removeMissingTagsFromGroups(
                        dbData.groups,
                        currentTags
                      );
                      if (changed) {
                        if (Object.keys(updatedGroups).length > 0) {
                          await savePostTagData({
                            postId,
                            updatedAt: Date.now(),
                            isImported: false,
                            groups: updatedGroups
                          });
                        } else {
                          await deletePostTagData(postId);
                        }
                      }
                    }
                  } catch (err) {
                    console.error("GroupingTags: DB Sync Failed", err);
                  }
                }
              }
              if (e.submitter && e.submitter.name) {
                const hiddenInput = document.createElement("input");
                hiddenInput.type = "hidden";
                hiddenInput.name = e.submitter.name;
                hiddenInput.value = e.submitter.value;
                form.appendChild(hiddenInput);
              }
              form.submit();
            } catch (error) {
              console.error("GroupingTags: Error during submit handling", error);
              isSubmitting = false;
            } finally {
              setTimeout(() => {
                isSubmitting = false;
              }, 1e3);
            }
          },
          { capture: true }
        );
        window.addEventListener("grouping-tags-db-update", () => {
          loadAndRestoreTags();
        });
      }
      function main() {
        AutoSyncManager.init();
        insertToggleButton();
        setupFormInterception();
        loadAndRestoreTags();
        setupDynamicFormObserver();
        if (isScriptEnabled()) {
          new SyntaxHighlighter("#post_tag_string, #upload_tag_string");
        }
        new SmartInputHandler(
          "#post_tag_string, #upload_tag_string",
          isScriptEnabled
        );
        if (window.location.pathname.startsWith("/posts/")) {
          new SidebarInjector(isScriptEnabled);
        }
      }
      main();

    })
  };
}));

System.register("./gist-init-C__mfkh8-B0qIP166.js", ['./main-BVjALz1Y-DsQB-M80.js'], (function (exports, module) {
  'use strict';
  var AuthManager, gmFetch;
  return {
    setters: [module => {
      AuthManager = module.A;
      gmFetch = module.g;
    }],
    execute: (function () {

      exports("initializeGist", initializeGist);

      const API_BASE = "https://api.github.com/gists";
      async function initializeGist() {
        const token = await AuthManager.getToken();
        if (!token) return void 0;
        const existingId = AuthManager.getGistId();
        if (existingId) {
          try {
            await fetchGist(existingId, token);
            return existingId;
          } catch (e) {
            console.warn("⚠️ Existing Gist not found. Creating new one.");
          }
        }
        const newGistId = await createNewGist(token);
        AuthManager.setGistId(newGistId);
        return newGistId;
      }
      async function createNewGist(token) {
        const initialFiles = {
          "manifest.json": {
            content: JSON.stringify(
              {
                schemaVersion: 1,
                lastSynced: Date.now(),
                device: navigator.userAgent,
                totalGroups: 0
              },
              null,
              2
            )
          },
          "README.md": {
            content: "# Danbooru Grouping Tags Data\n\nThis Gist is a data store for the UserScript."
          }
        };
        const response = await gmFetch(API_BASE, {
          method: "POST",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json"
          },
          body: JSON.stringify({
            description: "Danbooru Grouping Tags Data",
            public: false,
files: initialFiles
          })
        });
        const data = await response.json();
        return data.id;
      }
      async function fetchGist(gistId, token) {
        const res = await gmFetch(`${API_BASE}/${gistId}`, {
          headers: { Authorization: `token ${token}` }
        });
        return res.json();
      }

    })
  };
}));

System.register("./settings-panel-CTInzcqt-DgSbreep.js", ['./main-BVjALz1Y-DsQB-M80.js'], (function (exports, module) {
  'use strict';
  var detectDarkTheme, __vitePreload;
  return {
    setters: [module => {
      detectDarkTheme = module.d;
      __vitePreload = module._;
    }],
    execute: (function () {

      class SettingsPanel {
static show() {
          const isDark = detectDarkTheme();
          const bgColor = isDark ? "#222" : "#fff";
          const textColor = isDark ? "#eee" : "#333";
          const overlay = document.createElement("div");
          Object.assign(overlay.style, {
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 9998,
            display: "flex",
            justifyContent: "center",
            alignItems: "center"
          });
          const panel = document.createElement("div");
          Object.assign(panel.style, {
            backgroundColor: bgColor,
            color: textColor,
            padding: "20px",
            borderRadius: "10px",
            width: "400px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            display: "flex",
            flexDirection: "column",
            gap: "16px"
          });
          SettingsPanel.renderPanelContent(panel, isDark);
          overlay.appendChild(panel);
          document.body.appendChild(overlay);
          overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
              document.body.removeChild(overlay);
            }
          });
        }
static async renderPanelContent(panel, isDark) {
          const { AuthManager: AuthManager2 } = await __vitePreload(async () => {
            const { AuthManager: AuthManager22 } = await module.import('./main-BVjALz1Y-DsQB-M80.js').then((n) => n.a);
            return { AuthManager: AuthManager22 };
          }, void 0 );
          const token = await AuthManager2.getToken(true);
          const gistId = AuthManager2.getGistId();
          const isConnected = !!(token && gistId);
          panel.innerHTML = "";
          const header = document.createElement("h3");
          header.textContent = "⚙️ Grouping Tags Settings";
          header.style.margin = "0 0 10px 0";
          header.style.borderBottom = "1px solid #888";
          header.style.paddingBottom = "10px";
          panel.appendChild(header);
          const authBox = document.createElement("div");
          authBox.innerHTML = `
          <div style="font-size: 13px; margin-bottom: 4px;"><strong>My Gist ID:</strong></div>
          <div style="background: ${isDark ? "#333" : "#eee"}; padding: 6px; border-radius: 4px; font-family: monospace; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
            <span style="overflow: hidden; text-overflow: ellipsis;">${gistId || "Not Connected"}</span>
            ${!isConnected ? "🔴" : "🟢"}
          </div>
        `;
          panel.appendChild(authBox);
          const syncBtn = document.createElement("button");
          syncBtn.textContent = "☁️ Sync Now (Upload/Download)";
          Object.assign(syncBtn.style, {
            padding: "10px",
            backgroundColor: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
            marginTop: "10px",
            opacity: isConnected ? "1" : "0.5",
            pointerEvents: isConnected ? "auto" : "none"
          });
          if (!isConnected) {
            syncBtn.title = "Gist connection required.";
          }
          syncBtn.onclick = async () => {
            if (!gistId) return alert("No Gist ID found.");
            syncBtn.disabled = true;
            syncBtn.textContent = "🔄 Syncing...";
            try {
              const { getLocalDataByShard: getLocalDataByShard2 } = await __vitePreload(async () => {
                const { getLocalDataByShard: getLocalDataByShard22 } = await module.import('./main-BVjALz1Y-DsQB-M80.js').then((n) => n.c);
                return { getLocalDataByShard: getLocalDataByShard22 };
              }, true ? void 0 : void 0);
              const { SyncManager: SyncManager2 } = await __vitePreload(async () => {
                const { SyncManager: SyncManager22 } = await module.import('./main-BVjALz1Y-DsQB-M80.js').then((n) => n.b);
                return { SyncManager: SyncManager22 };
              }, true ? void 0 : void 0);
              for (let i = 0; i < 10; i++) {
                const localData = await getLocalDataByShard2(i);
                await SyncManager2.syncShard(i, localData, false);
              }
              alert("Sync completed! ✅");
            } catch (e) {
              alert(`Sync failed: ${e}`);
            } finally {
              syncBtn.disabled = false;
              syncBtn.textContent = "☁️ Sync Now (Upload/Download)";
            }
          };
          panel.appendChild(syncBtn);
          const importBox = document.createElement("div");
          importBox.style.marginTop = "15px";
          const label = document.createElement("div");
          label.textContent = "📥 Import External Gist";
          label.style.fontWeight = "bold";
          label.style.marginBottom = "8px";
          importBox.appendChild(label);
          const input = document.createElement("input");
          input.placeholder = "Paste Gist URL or ID here...";
          Object.assign(input.style, {
            width: "100%",
            padding: "8px",
            marginBottom: "8px",
            boxSizing: "border-box",
            borderRadius: "4px",
            border: "1px solid #ccc"
          });
          importBox.appendChild(input);
          const importBtn = document.createElement("button");
          importBtn.textContent = "Start Import";
          Object.assign(importBtn.style, {
            width: "100%",
            padding: "8px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            opacity: isConnected ? "1" : "0.5",
            pointerEvents: isConnected ? "auto" : "none"
          });
          importBtn.onclick = async () => {
            const val = input.value.trim();
            if (!val) return;
            const { ImportManager: ImportManager2, mergeGroups: mergeGroups2 } = await __vitePreload(async () => {
              const { ImportManager: ImportManager22, mergeGroups: mergeGroups22 } = await module.import('./import-manager-BZ8qaLNR-mM8ejxxo.js');
              return { ImportManager: ImportManager22, mergeGroups: mergeGroups22 };
            }, void 0 );
            const { getLocalDataByShard: getLocalDataByShard2, savePostTagData: savePostTagData2 } = await __vitePreload(async () => {
              const { getLocalDataByShard: getLocalDataByShard22, savePostTagData: savePostTagData22 } = await module.import('./main-BVjALz1Y-DsQB-M80.js').then((n) => n.c);
              return { getLocalDataByShard: getLocalDataByShard22, savePostTagData: savePostTagData22 };
            }, void 0 );
            const { ConflictModal: ConflictModal2 } = await __vitePreload(async () => {
              const { ConflictModal: ConflictModal22 } = await module.import('./conflict-modal-Kz3RA14p-DF9qniwG.js');
              return { ConflictModal: ConflictModal22 };
            }, void 0 );
            importBtn.disabled = true;
            importBtn.textContent = "⏳ Fetching...";
            try {
              let targetId = val;
              const urlMatch = val.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/);
              if (urlMatch) targetId = urlMatch[1];
              const remoteData = await ImportManager2.fetchExternalGist(targetId);
              const allLocal = {};
              for (let i = 0; i < 10; i++) {
                const shard = await getLocalDataByShard2(i);
                Object.assign(allLocal, shard);
              }
              const diffs = ImportManager2.compareWithLocal(allLocal, remoteData);
              const conflicts = diffs.filter((d) => d.status === "CONFLICT");
              const newItems = diffs.filter((d) => d.status === "NEW");
              for (const n of newItems) {
                n.remote.isImported = true;
                await savePostTagData2(n.remote);
              }
              if (conflicts.length > 0) {
                const overlay = panel.parentElement;
                if (overlay) document.body.removeChild(overlay);
                ConflictModal2.show(conflicts, async (res) => {
                  let count = 0;
                  for (const c of conflicts) {
                    let final = c.remote;
                    if (res === "MERGE" && c.local)
                      final = {
                        ...c.local,
                        groups: mergeGroups2(c.local.groups, c.remote.groups),
                        isImported: true
                      };
                    else if (res === "OVERWRITE") final.isImported = true;
                    if (res !== "KEEP") {
                      await savePostTagData2(final);
                      count++;
                    }
                  }
                  alert(
                    `Resolved! (New: ${newItems.length}, ${res === "MERGE" ? "Merged" : "Overwritten"}: ${count})`
                  );
                });
              } else {
                alert(`Done! Imported ${newItems.length} new items.`);
              }
            } catch (e) {
              alert("Import Error: " + e);
            } finally {
              importBtn.disabled = false;
              importBtn.textContent = "Start Import";
            }
          };
          importBox.appendChild(importBtn);
          panel.appendChild(importBox);
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.marginTop = "20px";
          closeBtn.onclick = () => {
            const overlay = panel.parentElement;
            if (overlay) document.body.removeChild(overlay);
          };
          panel.appendChild(closeBtn);
        }
      } exports("SettingsPanel", SettingsPanel);

    })
  };
}));

System.register("./login-modal-DWnGxy6T-CHz_dOuL.js", ['./main-BVjALz1Y-DsQB-M80.js'], (function (exports, module) {
  'use strict';
  var detectDarkTheme, AuthManager;
  return {
    setters: [module => {
      detectDarkTheme = module.d;
      AuthManager = module.A;
    }],
    execute: (function () {

      class LoginModal {
static show(onSuccess) {
          const isDark = detectDarkTheme();
          const bgColor = isDark ? "#222" : "#fff";
          const textColor = isDark ? "#eee" : "#333";
          const overlay = document.createElement("div");
          Object.assign(overlay.style, {
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.6)",
            zIndex: 1e4,
            display: "flex",
            justifyContent: "center",
            alignItems: "center"
          });
          const modal = document.createElement("div");
          Object.assign(modal.style, {
            backgroundColor: bgColor,
            color: textColor,
            padding: "24px",
            borderRadius: "12px",
            width: "500px",
            maxWidth: "90%",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            fontFamily: "sans-serif"
          });
          modal.innerHTML = `
            <h2 style="margin: 0 0 10px 0; border-bottom: 2px solid #0075ff; padding-bottom: 8px;">🔑 GitHub Connection Setup</h2>
            
            <div style="font-size: 14px; line-height: 1.5; color: ${isDark ? "#ccc" : "#555"};">
                <p style="margin-bottom: 12px;">
                    To save data to Gist (Cloud), a <strong>Personal Access Token</strong> is required.<br>
                    This token acts as a password, so please keep it safe.
                </p>
                
                <div style="background: ${isDark ? "#333" : "#f5f5f5"}; padding: 12px; borderRadius: 8px; border: 1px solid ${isDark ? "#444" : "#ddd"};">
                    <strong style="display:block; margin-bottom: 8px; color: ${isDark ? "#fff" : "#000"};">🛠️ How to generate a Token (One-time setup)</strong>
                    <ol style="margin: 0; padding-left: 20px; font-size: 13px;">
                        <li style="margin-bottom: 4px;">Log in to GitHub and go to <strong>Settings > Developer settings</strong>.</li>
                        <li style="margin-bottom: 4px;">Select <strong>Personal access tokens > Tokens (classic)</strong>.</li>
                        <li style="margin-bottom: 4px;">Click <strong>Generate new token (classic)</strong>.</li>
                        <li style="margin-bottom: 4px;">Enter a recognizable name like <strong>"Danbooru Tags"</strong> in the Note.</li>
                        <li style="margin-bottom: 4px;">Set Expiration to <strong>No expiration (Recommended)</strong>.</li>
                        <li style="margin-bottom: 4px; color: #ff6b6b; font-weight: bold;">Check ONLY the <strong>'gist'</strong> scope checkbox. ✅</li>
                        <li style="margin-bottom: 4px;">Copy the generated code starting with <code>ghp_...</code> and paste it below.</li>
                    </ol>
                </div>
            </div>
        `;
          const inputContainer = document.createElement("div");
          inputContainer.style.display = "flex";
          inputContainer.style.gap = "8px";
          inputContainer.style.marginTop = "8px";
          const input = document.createElement("input");
          input.placeholder = "ghp_xxxxxxxxxxxxxxxxxxxx";
          input.type = "password";
          Object.assign(input.style, {
            flex: "1",
            padding: "10px",
            borderRadius: "6px",
            border: "1px solid #888",
            backgroundColor: isDark ? "#444" : "#fff",
            color: textColor,
            fontFamily: "monospace"
          });
          const toggleVis = document.createElement("button");
          toggleVis.textContent = "👁️";
          Object.assign(toggleVis.style, {
            padding: "0 10px",
            borderRadius: "6px",
            border: "1px solid #888",
            backgroundColor: isDark ? "#444" : "#f0f0f0",
            cursor: "pointer"
          });
          toggleVis.onclick = () => {
            input.type = input.type === "password" ? "text" : "password";
          };
          const saveBtn = document.createElement("button");
          saveBtn.textContent = "Connect";
          Object.assign(saveBtn.style, {
            width: "100%",
            padding: "12px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "#0075ff",
            color: "white",
            fontWeight: "bold",
            fontSize: "15px",
            cursor: "pointer",
            marginTop: "4px"
          });
          saveBtn.onclick = async () => {
            const token = input.value.trim();
            if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
              alert("Invalid token format. (Must start with ghp_ or github_pat_)");
              return;
            }
            await AuthManager.setToken(token);
            document.body.removeChild(overlay);
            onSuccess();
          };
          overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
              document.body.removeChild(overlay);
            }
          });
          inputContainer.appendChild(input);
          inputContainer.appendChild(toggleVis);
          modal.appendChild(inputContainer);
          modal.appendChild(saveBtn);
          overlay.appendChild(modal);
          document.body.appendChild(overlay);
          input.focus();
        }
      } exports("LoginModal", LoginModal);

    })
  };
}));

System.register("./import-manager-BZ8qaLNR-mM8ejxxo.js", ['./main-BVjALz1Y-DsQB-M80.js'], (function (exports, module) {
  'use strict';
  var AuthManager, gmFetch, lzStringExports, sanitizeShardData;
  return {
    setters: [module => {
      AuthManager = module.A;
      gmFetch = module.g;
      lzStringExports = module.l;
      sanitizeShardData = module.s;
    }],
    execute: (function () {

      exports("mergeGroups", mergeGroups);

      class ImportManager {
static async fetchExternalGist(targetGistId) {
          const token = await AuthManager.getToken();
          const response = await gmFetch(
            `https://api.github.com/gists/${targetGistId}`,
            {
              headers: token ? { Authorization: `token ${token}` } : {}
            }
          );
          if (!response.ok) throw new Error("Gist not found");
          const json = await response.json();
          const allRemoteData = {};
          for (const [fileName, fileNode] of Object.entries(json.files)) {
            if (fileName.startsWith("tags_") && fileNode.content) {
              try {
                const decompressed = lzStringExports.decompressFromUTF16(
                  fileNode.content
                );
                const rawData = JSON.parse(decompressed || "{}");
                const cleanData = sanitizeShardData(rawData);
                Object.assign(allRemoteData, cleanData);
              } catch (e) {
                console.warn(`File parse failed: ${fileName}`, e);
              }
            }
          }
          return allRemoteData;
        }
static compareWithLocal(localData, remoteData) {
          const results = [];
          for (const [postId, remotePost] of Object.entries(remoteData)) {
            const localPost = localData[postId];
            if (!localPost) {
              results.push({ postId, status: "NEW", remote: remotePost });
              continue;
            }
            const isSame = this.isDeepEqual(localPost.groups, remotePost.groups);
            if (isSame) ;
            else {
              results.push({
                postId,
                status: "CONFLICT",
                local: localPost,
                remote: remotePost
              });
            }
          }
          return results;
        }
static isDeepEqual(obj1, obj2) {
          return JSON.stringify(obj1) === JSON.stringify(obj2);
        }
      } exports("ImportManager", ImportManager);
      function mergeGroups(localGroups, remoteGroups) {
        const merged = { ...localGroups };
        for (const [groupName, remoteTags] of Object.entries(remoteGroups)) {
          if (!merged[groupName]) {
            merged[groupName] = remoteTags;
            continue;
          }
          const localTags = merged[groupName];
          const unionTags = Array.from( new Set([...localTags, ...remoteTags])).sort();
          merged[groupName] = unionTags;
        }
        return merged;
      }

    })
  };
}));

System.register("./conflict-modal-Kz3RA14p-DF9qniwG.js", ['./main-BVjALz1Y-DsQB-M80.js'], (function (exports, module) {
  'use strict';
  var detectDarkTheme;
  return {
    setters: [module => {
      detectDarkTheme = module.d;
    }],
    execute: (function () {

      class ConflictModal {
static show(diffs, onResolve) {
          const isDark = detectDarkTheme();
          const bgColor = isDark ? "#222" : "#fff";
          const textColor = isDark ? "#eee" : "#333";
          const borderColor = isDark ? "#444" : "#ccc";
          const overlay = document.createElement("div");
          Object.assign(overlay.style, {
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.6)",
            zIndex: 1e4,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backdropFilter: "blur(2px)"
          });
          const modal = document.createElement("div");
          Object.assign(modal.style, {
            backgroundColor: bgColor,
            color: textColor,
            padding: "24px",
            borderRadius: "12px",
            width: "550px",
            maxHeight: "85vh",
            overflow: "hidden",
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column"
          });
          const title = document.createElement("h2");
          title.textContent = `⚠️ Data Conflict Detected (${diffs.length} items)`;
          title.style.margin = "0 0 16px 0";
          title.style.fontSize = "20px";
          title.style.borderBottom = `1px solid ${borderColor}`;
          title.style.paddingBottom = "12px";
          const desc = document.createElement("p");
          desc.textContent = "The external data differs from your local data.\nPlease choose how to resolve this conflict.";
          desc.style.whiteSpace = "pre-wrap";
          desc.style.marginBottom = "20px";
          desc.style.lineHeight = "1.5";
          desc.style.color = isDark ? "#ccc" : "#666";
          const list = document.createElement("div");
          Object.assign(list.style, {
            flex: "1",
            overflowY: "auto",
            marginBottom: "24px",
            border: `1px solid ${borderColor}`,
            borderRadius: "6px",
            backgroundColor: isDark ? "#1a1a1a" : "#f9f9f9",
            padding: "10px"
          });
          diffs.slice(0, 50).forEach((d) => {
            const item = document.createElement("div");
            item.style.padding = "8px";
            item.style.borderBottom = `1px solid ${isDark ? "#333" : "#eee"}`;
            item.style.fontSize = "12px";
            const pid = document.createElement("strong");
            pid.textContent = `Post #${d.postId}`;
            const info = document.createElement("span");
            const localGroups = Object.keys(d.local?.groups || {}).join(", ");
            const remoteGroups = Object.keys(d.remote.groups).join(", ");
            info.textContent = ` | Local: [${localGroups}] vs Remote: [${remoteGroups}]`;
            info.style.marginLeft = "10px";
            info.style.color = isDark ? "#aaa" : "#777";
            item.appendChild(pid);
            item.appendChild(info);
            list.appendChild(item);
          });
          if (diffs.length > 50) {
            const more = document.createElement("div");
            more.textContent = `...and ${diffs.length - 50} more items`;
            more.style.textAlign = "center";
            more.style.padding = "8px";
            more.style.color = "#888";
            list.appendChild(more);
          }
          const btnContainer = document.createElement("div");
          Object.assign(btnContainer.style, {
            display: "flex",
            gap: "12px",
            justifyContent: "flex-end"
          });
          const close = () => document.body.removeChild(overlay);
          const btnKeep = this.createBtn("Cancel (Keep Local)", "#777", () => {
            close();
            onResolve("KEEP");
          });
          const btnOverwrite = this.createBtn(
            "Overwrite (Use Remote)",
            "#d9534f",
            () => {
              if (confirm(
                "Are you sure you want to overwrite your local data with the remote data?"
              )) {
                close();
                onResolve("OVERWRITE");
              }
            }
          );
          const btnMerge = this.createBtn("Merge (Recommended)", "#0075ff", () => {
            close();
            onResolve("MERGE");
          });
          btnMerge.style.fontWeight = "bold";
          btnContainer.append(btnKeep, btnOverwrite, btnMerge);
          modal.append(title, desc, list, btnContainer);
          overlay.appendChild(modal);
          document.body.appendChild(overlay);
        }
        static createBtn(text, bgColor, onClick) {
          const btn = document.createElement("button");
          btn.textContent = text;
          Object.assign(btn.style, {
            backgroundColor: bgColor,
            color: "white",
            padding: "10px 20px",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "14px",
            transition: "opacity 0.2s"
          });
          btn.onmouseover = () => btn.style.opacity = "0.9";
          btn.onmouseout = () => btn.style.opacity = "1";
          btn.onclick = onClick;
          return btn;
        }
      } exports("ConflictModal", ConflictModal);

    })
  };
}));

System.import("./__entry.js", "./");