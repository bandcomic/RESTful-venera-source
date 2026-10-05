const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const sharp = require('sharp')
const { proxyImage, encodeLvgl } = require('../dist/core/image/proxy')
const runtime = require('../dist/core/runtime/venera')

test('indexed-8 boundary and palette structure', () => {
  const body = encodeLvgl(Buffer.alloc(2047*3,255),1,2047)
  const header = body.readUInt32LE()
  assert.equal(header>>>21,2047)
  assert.equal((header>>>10)&2047,1)
  assert.equal(body.length,1028+2047)
  assert.deepEqual([...body.subarray(4+255*4,8+255*4)],[255,255,255,255])
  assert.throws(()=>encodeLvgl(Buffer.alloc(2048*3),1,2048))
})

test('real sharp pipeline: long transparent image, singleflight, formats, credentials, hooks',async()=>{
  process.env.IMAGE_CACHE_DRIVER='memory'
  process.env.ENABLED_SOURCES='manga_dex'
  const image=await sharp({create:{width:50,height:2048,channels:4,background:{r:255,g:0,b:0,alpha:0}}}).png().toBuffer()
  let downloads=0
  const server=http.createServer((req,res)=>{ downloads++;res.setHeader('Content-Type','image/png');res.end(image) })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const url=`http://127.0.0.1:${server.address().port}/image`
  try{
    const context={baseUrl:'https://public.test'}
    const options={url,width:'50',ifLVGL:'1',ifPNG:'1'}
    const results=await Promise.all(Array.from({length:8},()=>proxyImage(options,context)))
    assert.equal(downloads,1)
    assert.equal(results[0].contentType,'application/octet-stream')
    const body=results[0].body,header=body.readUInt32LE(),w=(header>>>10)&2047,h=header>>>21
    assert.ok(w>=1&&h<=2047);assert.equal(body.length,1028+w*h)
    assert.equal(body[1028],255)
    assert.equal((await proxyImage({url,width:'50',ifLVGL:'true'},context)).cacheHit,true)
    const png=await proxyImage({url,ifPNG:'1'},context)
    const jpeg=await proxyImage({url},context)
    assert.equal(png.body.readUInt32BE(),0x89504e47);assert.equal(jpeg.body.readUInt16BE(),0xffd8)
    const before=downloads
    await proxyImage({url},{...context,cookie:'a=1'})
    await proxyImage({url},{...context,cookie:'b=2'})
    assert.equal(downloads,before+2)
    await assert.rejects(proxyImage({url,width:'0'},context),error=>error.status===400)
    await assert.rejects(proxyImage({url,source:'disabled'},context),error=>error.status===404)
    let covers=0,pages=0
    const original=runtime.loadSource
    runtime.loadSource=async()=>({comic:{onThumbnailLoad:()=>{covers++;return {url}},onImageLoad:()=>{pages++;return {url}}}})
    try{
      await proxyImage({url,source:'manga_dex',thumbnail:'1'},context)
      await proxyImage({url,source:'manga_dex'},context)
      assert.equal(covers,1);assert.equal(pages,1)
    }finally{runtime.loadSource=original}
  }finally{await new Promise(resolve=>server.close(resolve))}
})

test('source state is isolated by identity; disabled routes fail before upstream',async()=>{
  process.env.ENABLED_SOURCES='manga_dex'
  const a=await runtime.loadSource('manga_dex',{baseUrl:'https://public.test',cookie:'a=1'})
  const b=await runtime.loadSource('manga_dex',{baseUrl:'https://public.test',cookie:'b=2'})
  a.saveData('token','only-a')
  assert.equal(b.loadData('token'),undefined)
  assert.equal((await runtime.loadSource('manga_dex',{baseUrl:'https://public.test',cookie:'a=1'})).loadData('token'),'only-a')
  const {createServer}=require('../dist/server')
  const server=await createServer()
  try{
    const result=await server.inject({url:'/api/disabled/album/1'})
    assert.equal(result.statusCode,404)
    assert.equal(result.headers['cache-control'],'no-store')
  }finally{await server.close()}
})
