# S3 对象存储服务配置指南

请选择一家支持 S3 协议的对象存储服务提供商。

## 配置 S3 对象存储服务

这边以 `又拍云` 做为演示，其它运营商请查询对应文档。

参考: https://help.upyun.com/knowledge-base/aws-s3%E5%85%BC%E5%AE%B9/#e585bce5aeb9e5b7a5e585b7e7a4bae4be8b

1. 登录 [又拍云 - 加速在线业务 - CDN加速 - 云存储 (upyun.com)](https://www.upyun.com/)
2. 注册账户
3. 进入"云存储"控制台[又拍云控制台 (upyun.com)](https://console.upyun.com/services/file/)
4. 创建一个服务，记录你的服务名
5. 进入"用户管理"，"操作员"创建一个"操作员"并赋予相应权限
6. 编辑"操作员"复制"AccessKey"和"SecretAccessKey"
7. 如果读写权限未勾选则选中后确定
8. 回到 ChatGPT-Next-Web-LangChain 项目修改环境变量。按照以下信息填写：
   - `S3_ENDPOINT=http://s3.api.upyun.com`
   - `S3_ACCESS_KEY_ID=AccessKey`
   - `S3_SECRET_ACCESS_KEY=SecretAccessKey`
   - `S3_BUCKET=服务名`
9. Enjoy.
