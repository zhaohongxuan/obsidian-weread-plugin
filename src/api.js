"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
// import { Notice } from 'obsidian';
var axios_1 = require("axios");
var ApiManager = /** @class */ (function () {
    function ApiManager(cookie) {
        //   readonly baseUrl: string = 'https://i.weread.qq.com';
        this.baseUrl = 'http://localhost:8081';
        this.cookie = cookie;
    }
    ApiManager.prototype.getHeaders = function () {
        return {
            'Host': 'i.weread.qq.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
            // 'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Content-Type': 'application/json',
            'Cookie': "".concat(this.cookie)
        };
    };
    ApiManager.prototype.getNotebooks = function () {
        return __awaiter(this, void 0, void 0, function () {
            var noteBooks, resp, e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        noteBooks = [];
                        return [4 /*yield*/, axios_1["default"].get(this.baseUrl + '/notebooks', {})];
                    case 1:
                        resp = _a.sent();
                        noteBooks = resp.data.books;
                        //todo test code
                        noteBooks = noteBooks.slice(0, 10);
                        console.log("get notebooks from weread notebook count: ", noteBooks.length);
                        return [2 /*return*/, noteBooks];
                    case 2:
                        e_1 = _a.sent();
                        // new Notice('Failed to fetch weread notebooks . Please check your API token and try again.')
                        console.error('-----------------------getnote nookk--', e_1);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ApiManager.prototype.getNotebookHighlights = function (bookId) {
        return __awaiter(this, void 0, void 0, function () {
            var resp, e_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, axios_1["default"].get(this.baseUrl + '/highlights?bookId=' + bookId, {})];
                    case 1:
                        resp = _a.sent();
                        return [2 /*return*/, resp.data];
                    case 2:
                        e_2 = _a.sent();
                        // new Notice('Failed to fetch weread notebook highlights . Please check your API token and try again.')
                        console.error(e_2);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ApiManager.prototype.getNotebookReviews = function (bookId) {
        return __awaiter(this, void 0, void 0, function () {
            var resp, e_3;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, axios_1["default"].get(this.baseUrl + '/highlights?bookId=' + bookId, {})];
                    case 1:
                        resp = _a.sent();
                        return [2 /*return*/, resp.data];
                    case 2:
                        e_3 = _a.sent();
                        // new Notice('Failed to fetch weread notebook reviews . Please check your API token and try again.')
                        console.error(e_3);
                        return [3 /*break*/, 3];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    return ApiManager;
}());
exports["default"] = ApiManager;
var api = new ApiManager('');
// console.log(api.getNotebooks())
api.getNotebookHighlights('26785321').then(function (data) {
    console.log(data);
});
api.getNotebookReviews('26785321').then(function (data) {
    console.log(data);
});
