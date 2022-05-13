
# weread

## Endpoints

- [weread](#weread)
  - [Endpoints](#endpoints)
  - [Weread API](#weread-api)
    - [1. Weread 获取书籍的热门划线](#1-weread-获取书籍的热门划线)
    - [2. Weread 获取书籍详情](#2-weread-获取书籍详情)
    - [3. Weread 获取书籍个人想法](#3-weread-获取书籍个人想法)
    - [4. Weread 获取书籍划线](#4-weread-获取书籍划线)
    - [5. Weread 获取用户的Notebook](#5-weread-获取用户的notebook)

--------

## Weread API

### 1. Weread 获取书籍的热门划线

***Endpoint:***

```bash
Method: GET
Type: 
URL: https://i.weread.qq.com/book/bestbookmarks
```


***Headers:***

| Key | Value | Description |
| --- | ------|-------------|
| Host |  i.weread.qq.com |  |
| Connection |  keep-alive |  |
| Upgrade-Insecure-Requests |  1 |  |
| User-Agent |  Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36 |  |
| Accept |  text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3 |  |
| Accept-Encoding |  gzip, deflate, br |  |
| Accept-Language |  zh-CN,zh;q=0.9,en;q=0.8 |  |



***Query params:***

| Key | Value | Description |
| --- | ------|-------------|
| bookId | 26785321 |  |



### 2. Weread 获取书籍详情



***Endpoint:***

```bash
Method: GET
Type: 
URL: https://i.weread.qq.com/book/info
```


***Headers:***

| Key | Value | Description |
| --- | ------|-------------|
| Host |  i.weread.qq.com |  |
| Connection |  keep-alive |  |
| Upgrade-Insecure-Requests |  1 |  |
| User-Agent |  Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36 |  |
| Accept |  text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3 |  |
| Accept-Encoding |  gzip, deflate, br |  |
| Accept-Language |  zh-CN,zh;q=0.9,en;q=0.8 |  |



***Query params:***

| Key | Value | Description |
| --- | ------|-------------|
| bookId | 26785321 |  |



### 3. Weread 获取书籍个人想法



***Endpoint:***

```bash
Method: GET
Type: 
URL: https://i.weread.qq.com/review/list
```


***Headers:***

| Key | Value | Description |
| --- | ------|-------------|
| Host |  i.weread.qq.com |  |
| Connection |  keep-alive |  |
| Upgrade-Insecure-Requests |  1 |  |
| User-Agent |  Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36 |  |
| Accept |  text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3 |  |
| Accept-Encoding |  gzip, deflate, br |  |
| Accept-Language |  zh-CN,zh;q=0.9,en;q=0.8 |  |



***Query params:***

| Key | Value | Description |
| --- | ------|-------------|
| bookId | 26785321 |  |
| listType | 11 |  |
| mine | 1 |  |
| synckey | 0 |  |
| listMode |  |  |



### 4. Weread 获取书籍划线



***Endpoint:***

```bash
Method: GET
Type: 
URL: https://i.weread.qq.com/shelf/sync
```


***Headers:***

| Key | Value | Description |
| --- | ------|-------------|
| Host |  i.weread.qq.com |  |
| Connection |  keep-alive |  |
| Upgrade-Insecure-Requests |  1 |  |
| User-Agent |  Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36 |  |
| Accept |  text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3 |  |
| Accept-Encoding |  gzip, deflate, br |  |
| Accept-Language |  zh-CN,zh;q=0.9,en;q=0.8 |  |



***Query params:***

| Key | Value | Description |
| --- | ------|-------------|
| userVid | 15707910 |  |
| synckey | 0 |  |
| lectureSynckey | 0 |  |



### 5. Weread 获取用户的Notebook



***Endpoint:***

```bash
Method: GET
Type: 
URL: https://i.weread.qq.com/user/notebooks
```


***Headers:***

| Key | Value | Description |
| --- | ------|-------------|
| Host |  i.weread.qq.com |  |
| Connection |  keep-alive |  |
| Upgrade-Insecure-Requests |  1 |  |
| User-Agent |  Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.103 Safari/537.36 |  |
| Accept |  text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3 |  |
| Accept-Encoding |  gzip, deflate, br |  |
| Accept-Language |  zh-CN,zh;q=0.9,en;q=0.8 |  |



---
[Back to top](#weread)

>Generated at 2022-05-13 07:58:06 by [docgen](https://github.com/thedevsaddam/docgen)
