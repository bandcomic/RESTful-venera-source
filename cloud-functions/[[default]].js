// EdgeOne Pages 云函数入口（Express 框架模式，路由 /*）
// 构建器通过 AST 检测 import express + export default app 来识别框架函数，
// 因此本文件必须显式创建 express 实例
import express from "express";
import { createApp } from "./app.js";

const app = express();
app.use(createApp());

export default app;
