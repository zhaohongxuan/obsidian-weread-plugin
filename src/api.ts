
import { Notice } from 'obsidian';
import axios from 'axios';
export default class ApiManager {
//   readonly baseUrl: string = 'https://i.weread.qq.com';
  readonly baseUrl: string = 'http://localhost:8081';
  private cookie: string;

  constructor(cookie: string) {
    this.cookie = cookie;
  }

  private getHeaders() {
    return {
        'Host': 'i.weread.qq.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
        // 'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Content-Type': 'application/json',
        'Cookie': `${this.cookie}`
    }
  }

  async getNotebooks() {
      try {
        let noteBooks =[]
        const resp = await axios.get(this.baseUrl+'/notebooks',{
        })

        noteBooks = resp.data.books
        //todo test code
        noteBooks = noteBooks.slice(0, 2)
        console.log("get notebooks from weread notebook count: ", noteBooks.length)
        return noteBooks
      } catch (e) {
        // new Notice('Failed to fetch weread notebooks . Please check your API token and try again.')
        console.error('-----------------------getnote nookk--',e)
      }
  }
  async getNotebookHighlights(bookId:string) {

      try {
        const resp = await axios.get(this.baseUrl+'/highlights?bookId='+bookId,{})
        return resp.data
      } catch (e) {
        new Notice('Failed to fetch weread notebook highlights . Please check your API token and try again.')
        console.error(e);
      }
  }

  async getNotebookReviews(bookId:string){
      try {
        const resp = await axios.get(this.baseUrl+'/reviews?bookId='+bookId,{})
        return resp.data
      } catch (e) {
        new Notice('Failed to fetch weread notebook reviews . Please check your API token and try again.')
        console.error(e);
      }
  }
}

const api = new ApiManager('')
// console.log(api.getNotebooks())
api.getNotebookHighlights('26785321').then(data=>{
    console.log(data)
})
api.getNotebookReviews('26785321').then(data=>{
    console.log(data)
})