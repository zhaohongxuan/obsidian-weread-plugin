import ApiManager from "./api";
import ApiV2Manager from "./api-v2";
import { settingsStore } from "./settings";
import { get } from "svelte/store";

class ApiRouter {
    private readonly v1Manager: ApiManager;
    private readonly v2Manager: ApiV2Manager;

    constructor() {
        this.v1Manager = new ApiManager();
        this.v2Manager = new ApiV2Manager();
    }

    private useV2(): boolean {
        const settings = get(settingsStore);
        return Boolean(settings.wereadApiKey); // 如果有 API Key，优先用 V2
    }

    async getBook(bookId: string) {
        if (this.useV2()) {
            try {
                return await this.v2Manager.getBook(bookId);
            } catch (e) {
                console.warn("V2 调用失败，尝试切换到 V1", e);
            }
        }
        return this.v1Manager.getBook(bookId);
    }

    // 添加其他路由接口 ...
}

export default ApiRouter;