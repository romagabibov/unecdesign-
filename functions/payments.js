import {createHash,timingSafeEqual} from "node:crypto";
import {FieldValue,Timestamp} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onCall,onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {db,doc,paths,product,now,sha,fail,invalid,string,id,int,identity,limitRequest,reflectOrder} from "./shop.js";

const privateKey=defineSecret("EPOINT_PRIVATE_KEY");
const opts={secrets:[privateKey],timeoutSeconds:45};
const payment=id=>doc("payments",id);
const order=id=>doc(paths.orders,id);
const lock=uid=>doc("checkoutLocks",uid);
const isMock=()=>process.env.FUNCTIONS_EMULATOR==="true"&&process.env.SHOP_EMULATOR_PAYMENTS==="1";
const initialGrace=3*60*1000;
const statusDelay=15*60*1000;
const fallbackKey=()=>privateKey.value();
function sign(data,key) {
  return createHash("sha1").update(key+data+key,"utf8").digest("base64");
}
function unpack(data,signature,key) {
  if (typeof data!=="string"||data.length>8192||typeof signature!=="string"||signature.length!==28) return null;
  const expected=Buffer.from(sign(data,key)), received=Buffer.from(signature);
  if (expected.length!==received.length||!timingSafeEqual(expected,received)) return null;
  try { return JSON.parse(Buffer.from(data,"base64").toString("utf8")); } catch {return null;}
}
async function epoint(endpoint,payload) {
  const data=Buffer.from(JSON.stringify(payload)).toString("base64");
  const response=await fetch("https://epoint.az/api/1/"+endpoint,{
    method:"POST",body:new URLSearchParams({data,signature:sign(data,fallbackKey())}),
    redirect:"error",signal:AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error("Epoint HTTP "+response.status);
  return response.json();
}
function redirectAllowed(value) {
  const url=new URL(value);
  const extra=(process.env.EPOINT_REDIRECT_HOSTS||"").split(",").map(s=>s.trim()).filter(Boolean);
  if (url.protocol!=="https:"||url.username||url.password||url.port||(!(url.hostname==="epoint.az"||url.hostname.endsWith(".epoint.az")||extra.includes(url.hostname)))) {
    throw Error("Epoint checkout host is not allowed");
  }
  return url.href;
}
function shopOrigin() {
  const origin=new URL(process.env.SHOP_ORIGIN||"");
  if (origin.protocol!=="https:"||origin.username||origin.password) throw Error("SHOP_ORIGIN must be HTTPS");
  return origin.origin;
}
function matchesAmount(amount,total) {
  const value=String(amount);
  return /^\d+(?:\.\d{1,2})?$/.test(value)&&Math.round(Number(value)*100)===total;
}
async function settle(key,event) {
  const ref=order(key), pay=payment(key);
  return db.runTransaction(async tx=>{
    const [saved,details]=await tx.getAll(ref,pay);
    if (!saved.exists||!details.exists) return false;
    const o=saved.data(), p=details.data();
    const setupExpired=event.status==="setup_expired"&&!p.transaction;
    const success=event.status==="success";
    const returned=event.status==="returned";
    if (!setupExpired) {
      if (!p.transaction || p.transaction!==event.transaction || (event.currency&&event.currency!=="AZN")) return false;
      if (success&&(!matchesAmount(event.amount,o.total)||String(event.operation_code)!=="100")) return false;
      if (returned&&!matchesAmount(event.amount,o.total)) return false;
    }
    const pending=o.status==="payment_pending";
    const canRefund=returned&&["paid","ready","completed"].includes(o.status);
    if (!pending&&!canRefund) return true;
    if (!["success","failed","returned","setup_expired"].includes(event.status)) return false;
    const locked=lock(o.buyerUid), lockedSnap=await tx.get(locked);
    const products=o.items.map(i=>product(i.productId));
    if (pending) {
      for (const [index,work] of products.entries()) {
        const qty=o.items[index].qty;
        tx.update(work,{reserved:FieldValue.increment(-qty),...(!success?{stock:FieldValue.increment(qty)}:{})});
      }
    }
    const status=success?"paid":returned?"refunded":"payment_failed";
    tx.update(ref,{status,updatedAt:now()});
    tx.update(pay,{phase:"settled",checkedAt:now(),redirectUrl:FieldValue.delete(),nextCheckAt:FieldValue.delete()});
    if (lockedSnap.get("orderId")===key) tx.delete(locked);
    reflectOrder(tx,ref,o,status,success||canRefund);
    return true;
  });
}
async function reserve(uid,request) {
  const name=string(request.name,2,80), phone=string(request.phone,7,30), requestId=id(request.requestId);
  if (!/^[+0-9(). -]+$/.test(phone)||phone.replace(/\D/g,"").length<7) invalid();
  if (!Array.isArray(request.items)||request.items.length<1||request.items.length>20) invalid();
  const items=request.items.map(item=>({productId:id(item?.productId),qty:int(item?.qty,1,20)}));
  if (new Set(items.map(item=>item.productId)).size!==items.length) invalid();
  const key=sha(uid+":"+requestId).slice(0,32), ref=order(key), pay=payment(key), locked=lock(uid);
  const productRefs=items.map(i=>product(i.productId));
  return db.runTransaction(async tx=>{
    const [saved,details,existing]=await tx.getAll(ref,pay,locked);
    if (saved.exists) return {key,created:false,status:saved.get("status"),url:details.get("redirectUrl")};
    if (existing.exists) fail("failed-precondition","Gözləyən sifarişin var. Ödənişə kabinetdən qayıt.");
    const works=await tx.getAll(...productRefs);
    const rows=works.map((snap,index)=>{
      const p=snap.data(), {productId,qty}=items[index];
      if (!p||p.status!=="published"||p.stock<qty) fail("failed-precondition","Səbətdəki işlərdən birinin sayı kifayət deyil.");
      if (p.sellerUid===uid) fail("failed-precondition","Öz işini satın ala bilməzsən.");
      return {productId,qty,title:p.title,image:p.image,price:p.price,sellerUid:p.sellerUid};
    });
    const total=rows.reduce((acc,row)=>acc+row.price*row.qty,0), createdAt=now();
    tx.create(ref,{buyerUid:uid,name,phone,items:rows,total,currency:"AZN",status:"payment_pending",createdAt,updatedAt:createdAt});
    tx.create(pay,{phase:"creating",nextCheckAt:Timestamp.fromMillis(Date.now()+initialGrace),createdAt});
    tx.create(locked,{orderId:key,createdAt});
    for (const [index,row] of rows.entries()) tx.update(productRefs[index],{stock:FieldValue.increment(-row.qty),reserved:FieldValue.increment(row.qty)});
    return {key,created:true,total};
  });
}
const startCheckout=onCall(opts,async req=>{
  const {uid}=identity(req);
  const mock=isMock();
  if (!mock&&(process.env.EPOINT_ENABLED!=="1"||!process.env.EPOINT_PUBLIC_KEY||!process.env.SHOP_ORIGIN)) {
    fail("failed-precondition","Onlayn ödəniş hələ aktiv deyil.");
  }
  await limitRequest("checkout",req,12,3600000);
  const result=await reserve(uid,req.data||{}), {key,total}=result;
  if (!result.created) return {id:key,status:result.status,...(result.url?{url:result.url}:{})};
  if (mock) {
    const transaction="emulator-"+key;
    await payment(key).update({transaction,phase:"open"});
    await settle(key,{status:"success",transaction,amount:total/100,operation_code:"100"});
    return {id:key};
  }
  try {
    const origin=shopOrigin(), base=origin+"/#account/orders?order="+key+"&payment=";
    const gateway=await epoint("request",{
      public_key:process.env.EPOINT_PUBLIC_KEY, amount:(total/100).toFixed(2), currency:"AZN", language:"az",
      description:"UNEC Dizayn Shop", order_id:key,success_redirect_url:base+"return",error_redirect_url:base+"error",
    });
    if (gateway.status!=="success") throw Error("Epoint did not create checkout");
    const transaction=id(gateway.transaction), url=redirectAllowed(gateway.redirect_url), ref=payment(key);
    await db.runTransaction(async tx=>{
      if ((await tx.get(ref)).get("phase")!=="creating") throw Error("Checkout is no longer active");
      tx.update(ref,{transaction,redirectUrl:url,phase:"open",nextCheckAt:Timestamp.fromMillis(Date.now()+statusDelay)});
    });
    return {id:key,url};
  } catch (error) {
    console.warn("Epoint checkout creation failed",key,error instanceof Error?error.name:"Error");
    await settle(key,{status:"setup_expired"});
    return {id:key,status:"payment_failed"};
  }
});
async function checkPayment(key,p) {
  if (!p.transaction) {
    if (Date.now()-p.createdAt.toMillis()>=initialGrace) await settle(key,{status:"setup_expired"});
    return;
  }
  const info=await epoint("get-status",{public_key:process.env.EPOINT_PUBLIC_KEY,transaction:p.transaction});
  await settle(key,info);
  const ref=payment(key);
  await db.runTransaction(async tx=>{
    const saved=await tx.get(ref);
    if (saved.get("phase")==="open") tx.update(ref,{nextCheckAt:Timestamp.fromMillis(Date.now()+statusDelay)});
  });
}
const resolvePayment=onCall(opts,async req=>{
  const {uid,role}=identity(req), key=id(req.data?.id), ref=order(key), p=payment(key);
  const [o,details]=await db.getAll(ref,p);
  if (!o.exists||(o.get("buyerUid")!==uid&&role!=="admin")) fail("not-found","Sifariş tapılmadı.");
  if (o.get("status")!=="payment_pending") return {status:o.get("status")};
  await limitRequest("payment-status",req,12,600000);
  if (details.exists && process.env.EPOINT_ENABLED==="1") await checkPayment(key,details.data()).catch(()=>{});
  const [updated,latest]=await db.getAll(ref,p);
  const status=updated.get("status");
  return {status,...(status==="payment_pending"&&latest.get("redirectUrl")?{url:latest.get("redirectUrl")}:{})};
});
const epointCallback=onRequest(opts,async (req,res)=>{
  if (req.method!=="POST") {res.status(405).send("POST required");return;}
  if (process.env.EPOINT_ENABLED!=="1") {res.status(503).send("Disabled");return;}
  const body=Buffer.isBuffer(req.body)||typeof req.body==="string"?Object.fromEntries(new URLSearchParams(String(req.body))):req.body||{};
  const payload=unpack(body.data,body.signature,fallbackKey());
  if (!payload||typeof payload.order_id!=="string"||!/^[a-f0-9]{32}$/.test(payload.order_id)) {res.status(401).send("Invalid signature or payload");return;}
  if (!["success","failed","returned"].includes(payload.status)) {res.status(200).send("Ignored");return;}
  try {
    if (await settle(payload.order_id,payload)) res.status(200).send("OK");
    else res.status(409).send("Payment mismatch");
  } catch {res.status(503).send("Retry");}
});
const reconcilePayments=onSchedule({schedule:"every 15 minutes",secrets:[privateKey],timeoutSeconds:240,maxInstances:1},async()=>{
  if (process.env.EPOINT_ENABLED!=="1") return;
  const pending=await db.collection("payments").where("nextCheckAt","<=",now()).orderBy("nextCheckAt").limit(48).get();
  for (let offset=0;offset<pending.docs.length;offset+=8) {
    await Promise.all(pending.docs.slice(offset,offset+8).map(async snap=>{
      try {await checkPayment(snap.id,snap.data());}
      catch {
        await db.runTransaction(async tx=>{
          if ((await tx.get(snap.ref)).get("phase")==="open") tx.update(snap.ref,{nextCheckAt:Timestamp.fromMillis(Date.now()+statusDelay)});
        });
      }
    }));
  }
});

export {startCheckout,resolvePayment,epointCallback,reconcilePayments};
