import {createHash} from "node:crypto";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue,Timestamp,getFirestore} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {setGlobalOptions} from "firebase-functions/v2";
import {onCall,HttpsError} from "firebase-functions/v2/https";

initializeApp();
setGlobalOptions({region:"europe-west1",maxInstances:10});
const db=getFirestore();
const paths={products:"products",taxonomy:"taxonomy",orders:"orders",users:"users"};
const doc=(name,id)=>db.collection(name).doc(id);
const product=id=>doc(paths.products,id);
const user=id=>doc(paths.users,id);
const now=()=>Timestamp.now();
const sha=value=>createHash("sha256").update(value).digest("hex");
const fail=(code,message)=>{throw new HttpsError(code,message);};
const invalid=()=>fail("invalid-argument","Göndərilən məlumatları yoxla.");
function string(value,min,max) {
  if (typeof value!=="string") invalid();
  const text=value.trim();
  if (text.length<min||text.length>max) invalid();
  return text;
}
function id(value) {
  const valid=string(value,1,128);
  if (!/^[A-Za-z0-9_-]+$/.test(valid)) invalid();
  return valid;
}
function int(value,min,max) {
  if (!Number.isSafeInteger(value)||value<min||value>max) invalid();
  return value;
}
function identity(req,roles) {
  if (!req.auth) fail("unauthenticated","Hesabına daxil ol.");
  const role=req.auth.token.role||"buyer";
  if (roles&&!roles.includes(role)) fail("permission-denied","Bu əməliyyat üçün icazən yoxdur.");
  return {uid:req.auth.uid,role};
}
function clientKey(req) {
  return req.auth ? "auth:"+req.auth.uid : "ip:"+(req.rawRequest.ip||req.rawRequest.socket?.remoteAddress||"unknown");
}
function rateRef(kind,actor) {return doc("rateLimits",sha(kind+":"+actor));}
function take(tx,ref,snap,max,window) {
  const time=Date.now(), before=snap.data();
  const reset=!before||before.expiresAt.toMillis()<=time;
  const count=reset?0:before.count;
  if (count>=max) fail("resource-exhausted","Çox sayda sorğu göndərilib. Bir az sonra yenidən cəhd et.");
  tx.set(ref,{count:count+1,expiresAt:reset?Timestamp.fromMillis(time+window):before.expiresAt});
}
async function limitRequest(kind,req,max,window) {
  const ref=rateRef(kind,clientKey(req));
  return db.runTransaction(async tx=>take(tx,ref,await tx.get(ref),max,window));
}
function notice(tx,uid,key,title,message,link) {
  tx.set(user(uid).collection("notifications").doc(key),{title,message,link,createdAt:now()});
}
const messages={paid:"Ödəniş təsdiqləndi.",ready:"Sifariş təhvilə hazırdır.",completed:"Sifariş tamamlandı.",payment_failed:"Ödəniş tamamlanmadı.",refunded:"Ödəniş geri qaytarıldı."};
function reflectOrder(tx,ref,order,status,includeSales) {
  const short="#"+ref.id.slice(0,9);
  notice(tx,order.buyerUid,ref.id+"-"+status,"Sifariş "+short,messages[status],"#account/orders");
  if (!includeSales) return;
  const sellers=new Set();
  for (const item of order.items) {
    sellers.add(item.sellerUid);
    tx.set(user(item.sellerUid).collection("sales").doc(ref.id+"_"+item.productId),{productId:item.productId,title:item.title,qty:item.qty,price:item.price,orderId:ref.id,createdAt:order.createdAt,status});
    if (status==="completed") tx.set(user(order.buyerUid).collection("purchases").doc(item.productId),{createdAt:now()});
  }
  for (const seller of sellers) notice(tx,seller,ref.id+"-"+status+"-sale","Satış "+short,messages[status],"#account/sales");
}
const workTypes=new Set(["image/jpeg","image/png","image/webp","image/avif"]);
async function artwork(imagePath,uid,workId) {
  const path=string(imagePath,1,450), prefix="work-images/"+uid+"/"+workId+"/";
  if (!path.startsWith(prefix)) fail("permission-denied","Şəkil bu hesaba aid deyil.");
  id(path.slice(prefix.length));
  const file=getStorage().bucket().file(path);
  let metadata;
  try { [metadata]=await file.getMetadata(); } catch (error) { if (error.code===404) invalid(); throw error; }
  const size=Number(metadata.size), type=metadata.contentType;
  if (!workTypes.has(type)||size<12||size>5*1024*1024) invalid();
  const [head]=await file.download({start:0,end:31,validation:false});
  const match={
    "image/jpeg":head[0]===255&&head[1]===216&&head[2]===255,
    "image/png":head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    "image/webp":head.toString("ascii",0,4)==="RIFF"&&head.toString("ascii",8,12)==="WEBP",
    "image/avif":head.toString("ascii",4,8)==="ftyp"&&/avif|avis/.test(head.toString("ascii",8,32)),
  }[type];
  if (!match) fail("invalid-argument","Şəkil faylının formatı uyğun deyil.");
  const token=metadata.metadata?.firebaseStorageDownloadTokens?.split(",")[0];
  if (!token) fail("failed-precondition","Şəkli yenidən yüklə.");
  const emulator=process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  const origin=emulator?"http://"+emulator:"https://firebasestorage.googleapis.com";
  const image=origin+"/v0/b/"+encodeURIComponent(file.bucket.name)+"/o/"+encodeURIComponent(path)+"?alt=media&token="+encodeURIComponent(token);
  return {image,imagePath:path};
}

const sendQuestion=onCall(async req=>{
  const values=req.data||{};
  if (values.website) return {ok:true};
  const name=string(values.name,2,80), email=string(values.email,5,120), message=string(values.message,10,1500);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid();
  const ref=rateRef("question",clientKey(req)), question=db.collection("questions").doc();
  await db.runTransaction(async tx=>{
    take(tx,ref,await tx.get(ref),5,3600000);
    tx.create(question,{name,email,message,createdAt:now()});
  });
  return {ok:true};
});
const recordView=onCall(async req=>{
  const pid=id(req.data?.id), day=new Date().toISOString().slice(0,10), actor=clientKey(req);
  const marker=doc("viewMarkers",sha(actor+":"+pid+":"+day)), productRef=product(pid), rate=rateRef("view",actor);
  await db.runTransaction(async tx=>{
    const seen=await tx.get(marker);
    if (seen.exists) return;
    const [work,rateSnap]=await tx.getAll(productRef,rate);
    if (!work.exists||work.get("status")!=="published") return;
    take(tx,rate,rateSnap,60,86400000);
    tx.create(marker,{expiresAt:Timestamp.fromMillis(Date.now()+2*86400000)});
    tx.update(productRef,{views:FieldValue.increment(1)});
  });
  return {ok:true};
});
const savePreferences=onCall(async req=>{
  const {uid}=identity(req), data=req.data||{}, patch={};
  if (typeof data.arrivals==="boolean") patch.arrivals=data.arrivals;
  if (data.seen===true) patch.seenAt=Date.now();
  if (!Object.keys(patch).length) invalid();
  await user(uid).set(patch,{merge:true});
  return {ok:true};
});
const saveTaxonomy=onCall(async req=>{
  identity(req,["admin"]);
  const data=req.data||{}, key=id(data.id), name=string(data.name,2,40), position=int(data.position,0,999), ref=doc(paths.taxonomy,key);
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref), kind=snap.get("kind")||data.kind;
    if (!["category","section"].includes(kind)) invalid();
    tx.set(ref,{name,position,kind,updatedAt:now()},{merge:true});
  });
  return {id:key};
});
const saveWork=onCall(async req=>{
  const {uid,role}=identity(req,["admin","student"]), data=req.data||{}, key=id(data.id), ref=product(key);
  const title=string(data.title,2,90), author=string(data.author,2,80), description=string(data.description,5,2000);
  const category=id(data.category), section=data.section?id(data.section):"", price=int(data.price,1,10000000), stock=int(data.stock,0,1000);
  const status=role==="admin"?data.status:"pending";
  if (!["draft","pending","published","archived"].includes(status)) invalid();
  await limitRequest("work",req,30,3600000);
  const sellerCandidate=role==="admin"&&data.sellerUid?id(data.sellerUid):uid;
  if (sellerCandidate!==uid) {
    const seller=await getAuth().getUser(sellerCandidate).catch(error=>{
      if (error.code==="auth/user-not-found") fail("invalid-argument","Tələbə hesabı tapılmadı.");
      throw error;
    });
    if (seller.customClaims?.role!=="student") fail("invalid-argument","Bu hesab tələbə rolunda deyil.");
  }
  const uploaded=data.imagePath?await artwork(data.imagePath,uid,key):null;
  await db.runTransaction(async tx=>{
    const refs=[ref,doc(paths.taxonomy,category)];
    if (section) refs.push(doc(paths.taxonomy,section));
    const [existing,cat,sect]=await tx.getAll(...refs);
    if (cat.get("kind")!=="category" || (section&&sect.get("kind")!=="section")) invalid();
    const previous=existing.data();
    if (previous&&role==="student"&&(previous.sellerUid!==uid||!["draft","pending"].includes(previous.status))) {
      fail("permission-denied","Bu işi redaktə etmək üçün icazən yoxdur.");
    }
    if (!previous&&!uploaded) fail("invalid-argument","İşin şəklini əlavə et.");
    const next={title,author,description,category,section,price,status,updatedAt:now()};
    if (!previous) Object.assign(next,{stock,views:0,reserved:0,createdAt:now(),sellerUid:sellerCandidate});
    else {
      const stockBefore=int(data.stockBefore,0,1000);
      if (stock!==stockBefore) {
        if (previous.stock!==stockBefore) fail("aborted","Mövcud say dəyişib. Səhifəni yenilə.");
        if (stock+(previous.reserved||0)>1000) invalid();
        next.stock=stock;
      }
    }
    if (uploaded) Object.assign(next,uploaded);
    if (status==="published"&&previous?.status!=="published") next.publishedAt=now();
    tx.set(ref,next,{merge:true});
    const arrival=doc("arrivals",key);
    if (status==="published") tx.set(arrival,{title,author,publishedAt:next.publishedAt||previous.publishedAt});
    else if (previous?.status==="published") tx.delete(arrival);
    if (previous&&previous.status!==status) notice(tx,previous.sellerUid,key+"-"+now().toMillis(),"İşin statusu dəyişdi",title,"#account/works");
  });
  return {id:key};
});
const writeReview=onCall(async req=>{
  const {uid}=identity(req), data=req.data||{}, key=id(data.productId), text=string(data.text,5,600), rating=int(data.rating,1,5), ref=product(key);
  const purchase=user(uid).collection("purchases").doc(key), limit=rateRef("review",uid);
  const author=typeof req.auth.token.name==="string"?req.auth.token.name.trim().slice(0,80)||"Alıcı":"Alıcı";
  await db.runTransaction(async tx=>{
    const [entitlement,work,rateSnap]=await tx.getAll(purchase,ref,limit);
    if (!entitlement.exists) fail("permission-denied","Rəy yalnız tamamlanmış alışdan sonra yazıla bilər.");
    if (work.get("status")!=="published") fail("not-found","İş tapılmadı.");
    take(tx,limit,rateSnap,15,3600000);
    tx.set(ref.collection("reviews").doc(sha(uid)),{author,text,rating,createdAt:now()});
  });
  return {ok:true};
});
const advanceOrder=onCall(async req=>{
  identity(req,["admin"]);
  const data=req.data||{}, ref=doc(paths.orders,id(data.id));
  await db.runTransaction(async tx=>{
    const order=(await tx.get(ref)).data(), status=data.status;
    if (!order || ({paid:"ready",ready:"completed"}[order.status]!==status) || !["ready","completed"].includes(status)) fail("failed-precondition","Status keçidi mümkün deyil.");
    tx.update(ref,{status,updatedAt:now()});
    reflectOrder(tx,ref,order,status,true);
  });
  return {ok:true};
});

export { db, doc, paths, product, user, now, sha, fail, invalid, string, id, int, identity, limitRequest, reflectOrder, sendQuestion, recordView, savePreferences, saveTaxonomy, saveWork, writeReview, advanceOrder };
