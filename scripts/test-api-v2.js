import ApiV2Manager from "../src/api-v2";

async function testApiV2() {
    const apiV2 = new ApiV2Manager();

    try {
        console.log("测试 getBook 接口...");
        const book = await apiV2.getBook("T202107310023715"); // 示例书籍 ID
        console.log("书籍详情: ", JSON.stringify(book, null, 2));

        console.log("测试 getNotebookHighlights 接口...");
        const highlights = await apiV2.getNotebookHighlights("T202107310023715");
        console.log("书籍高亮: ", JSON.stringify(highlights, null, 2));

        console.log("测试 getProgress 接口...");
        const progress = await apiV2.getProgress("T202107310023715");
        console.log("阅读进度: ", JSON.stringify(progress, null, 2));
    } catch (error) {
        console.error("Api 测试失败: ", error);
    }
}

testApiV2();