import { settingsStore } from "./settings";
import { get } from "svelte/store";

class ApiV2Manager {
    private readonly gatewayUrl: string = "https://i.weread.qq.com/api/agent/gateway";

    private async callAgent<T>(apiName: string, params: Record<string, unknown> = {}): Promise<T | undefined> {
        const settings = get(settingsStore);

        if (!settings.wereadApiKey) {
            console.error("API Key 未配置，请在设置中填写。");
            return undefined;
        }

        const response = await fetch(this.gatewayUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${settings.wereadApiKey}`,
            },
            body: JSON.stringify({
                api_name: apiName,
                skill_version: "1.0.3",
                ...params,
            }),
        });

        if (!response.ok) {
            console.error(`Agent API 调用失败: ${response.statusText}`);
            return undefined;
        }

        const data = await response.json();
        if (data.errcode && data.errcode !== 0) {
            console.error(`Agent API 错误: ${data.errmsg}`);
            return undefined;
        }

        return data as T;
    }

    async getBook(bookId: string) {
        return this.callAgent("/book/info", { bookId });
    }

    async getNotebookHighlights(bookId: string) {
        return this.callAgent("/book/bookmarklist", { bookId });
    }

    async getProgress(bookId: string) {
        return this.callAgent("/book/getProgress", { bookId });
    }

    async getReadingStats(mode: string, baseTime?: number) {
        const params: Record<string, unknown> = { mode };
        if (baseTime !== undefined) params.baseTime = baseTime;
        return this.callAgent("/readdata/detail", params);
    }

    async getNotebookChapters(bookId: string) {
        return this.callAgent("/book/chapterInfos", { bookIds: [bookId] });
    }

    async getNotebookReviews(bookId: string) {
        return this.callAgent("/review/list", {
            bookId,
            listType: 11,
            mine: 1,
            synckey: 0,
        });
    }

    async getUserInfo(userVid: string) {
        return this.callAgent("/user/info", { userVid });
    }
}

export default ApiV2Manager;