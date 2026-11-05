const {strict:assert}=await import("node:assert");
const {getAuth}=await import("firebase-admin/auth");
const {getFirestore}=await import("firebase-admin/firestore");
const {readFile}=await import("node:fs/promises");
const {randomUUID}=await import("node:crypto");

const projectId="demo-unec-dizayn-shop";
process.env.FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST="127.0.0.1:8080";
process.env.FIREBASE_STORAGE_EMULATOR_HOST="127.0.0.1:9199";
process.env.FUNCTIONS_EMULATOR="true";
process.env.SHOP_EMULATOR_PAYMENTS="1";
process.env.FIREBASE_CONFIG=JSON.stringify({projectId,storageBucket:projectId+".appspot.com"});
const handlers=await import("./index.js");
const auth=getAuth(),db=getFirestore(),nonce=randomUUID().slice(0,8), bucket=projectId+".appspot.com";
const authUrl="http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake";
const firestore="http://127.0.0.1:8080/v1/projects/"+projectId+"/databases/(default)/documents";
async function persona(role,letter="") {
  const email=role+letter+"-"+nonce+"@example.test",password="Test-pass-2026!";
  const {uid}=await auth.createUser({email,password,displayName:role+letter});
  if(role!=="buyer") await auth.setCustomUserClaims(uid,{role});
  const response=await fetch(authUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});
  const info=await response.json();assert.ok(info.idToken,JSON.stringify(info));return {uid,token:info.idToken};
}
const headers=who=>({...who?{Authorization:"Bearer "+who.token}:{}, "Content-Type":"application/json"});
async function call(name,data,who,expected) {
  const token=who?await auth.verifyIdToken(who.token):null;
  try {
    const value=await handlers[name].run({data,auth:token?{uid:token.uid,token}:undefined,rawRequest:{ip:"127.0.0.1"}});
    assert.ok(!expected,"Expected "+expected);
    return value;
  } catch (error) {
    if (!expected) throw error;
    assert.equal(error.code?.toUpperCase().replaceAll("-","_"),expected,error.stack);
  }
}
async function upload(who,owner,work,body,expected) {
  const location="work-images/"+owner.uid+"/"+work+"/"+randomUUID();
  const response=await fetch("http://127.0.0.1:9199/v0/b/"+bucket+"/o?name="+encodeURIComponent(location),{
    method:"POST",headers:{Authorization:"Firebase "+who.token,"Content-Type":"image/webp"},body,
  });
  const info=await response.json();
  assert.equal(response.status,expected,JSON.stringify(info));return location;
}
async function document(path,who) {
  return fetch(firestore+"/"+path,{headers:headers(who)});
}
async function queryWork(who,filter,limited=true) {
  const structuredQuery={from:[{collectionId:"products"}],...(limited?{limit:10}:{}),...filter?{where:{fieldFilter:{field:{fieldPath:filter[0]},op:"EQUAL",value:{stringValue:filter[1]}}}}:{}};
  return fetch(firestore+":runQuery",{method:"POST",headers:headers(who),body:JSON.stringify({structuredQuery})});
}
const [admin,student,buyer,buyer2]=await Promise.all([persona("admin"),persona("student"),persona("buyer","a"),persona("buyer","b")]);
const category="category-"+nonce, section="section-"+nonce, work="work-"+nonce;
await call("saveTaxonomy",{id:category,kind:"category",name:"Heykəltəraşlıq",position:0},admin);
await call("saveTaxonomy",{id:section,kind:"section",name:"Test kolleksiyası",position:0},admin);
await call("saveTaxonomy",{id:category,kind:"category",name:"Invalid",position:0},buyer,"PERMISSION_DENIED");
const image=await readFile(new URL("../dist/assets/work-2.webp",import.meta.url));
await upload(buyer,buyer,work,image,403);
await upload(student,buyer,work,image,403);
const imagePath=await upload(student,student,work,image,200);
const changes={id:work,title:"Test işi",author:"Test müəllif",description:"Tələbə işi üçün təsvir",category,section,stock:1,price:10000};
await call("saveWork",{...changes,imagePath},student);
assert.equal((await document("products/"+work)).status,403);
assert.equal((await document("products/"+work,student)).status,200);
assert.equal((await document("products/"+work,buyer)).status,403);
assert.equal((await queryWork(null,["status","published"],false)).status,403);
assert.equal((await queryWork(student,["sellerUid",student.uid])).status,200);
await call("saveWork",{...changes,stockBefore:1,status:"published"},admin);
assert.equal((await queryWork(null,["status","published"])).status,200);
assert.equal((await document("products/"+work)).status,200);
await call("saveWork",{...changes,stockBefore:1,status:"archived"},student,"PERMISSION_DENIED");
const forbidden=await fetch(firestore+"/products/"+work,{method:"PATCH",headers:headers(admin),body:JSON.stringify({fields:{stock:{integerValue:"200"}}})});
assert.equal(forbidden.status,403);
assert.equal((await db.collection("arrivals").doc(work).get()).get("title"),changes.title);
await call("recordView",{id:work},buyer);
await call("recordView",{id:work},buyer);
assert.equal((await db.collection("products").doc(work).get()).get("views"),1);
await call("writeReview",{productId:work,text:"Vaxtından əvvəl rəy",rating:5},buyer,"PERMISSION_DENIED");

const request={items:[{productId:work,qty:1}],name:"Test alıcı",phone:"+994 00 000 00 00",requestId:randomUUID()};
const competing=await Promise.all([buyer,buyer2].map(who=>call("startCheckout",request,who).then(value=>({value,who}),()=>null)));
const winners=competing.filter(Boolean);assert.equal(winners.length,1);
const {value:{id},who}=winners[0],other=who===buyer?buyer2:buyer;
assert.equal((await call("startCheckout",request,who)).id,id);
const orders=db.collection("orders");
assert.equal((await orders.doc(id).get()).get("total"),10000);
assert.equal((await orders.doc(id).get()).get("status"),"paid");
assert.equal((await db.collection("products").doc(work).get()).get("stock"),0);
assert.equal((await document("orders/"+id,other)).status,403);
assert.equal((await document("orders/"+id,who)).status,200);
assert.equal((await document("orders/"+id,student)).status,403);
await call("advanceOrder",{id,status:"completed"},admin,"FAILED_PRECONDITION");
await call("advanceOrder",{id,status:"ready"},other,"PERMISSION_DENIED");
await call("advanceOrder",{id,status:"ready"},admin);
await call("advanceOrder",{id,status:"completed"},admin);
assert.equal((await db.collection("users").doc(student.uid).collection("sales").doc(id+"_"+work).get()).get("status"),"completed");
assert.equal((await db.collection("users").doc(who.uid).collection("notifications").get()).size,3);
await call("writeReview",{productId:work,text:"Təsdiqlənmiş rəy",rating:5},who);
await call("writeReview",{productId:work,text:"Təsdiqlənmiş yeni rəy",rating:4},who);
assert.equal((await db.collection("products").doc(work).collection("reviews").get()).size,1);
await call("sendQuestion",{name:"Test istifadəçi",email:"test@example.test",message:"Bu bir sınaq sualıdır."},null);
const [question]=((await db.collection("questions").get()).docs);
assert.equal((await document("questions/"+question.id,who)).status,403);
assert.equal((await document("questions/"+question.id,admin)).status,200);
await call("savePreferences",{arrivals:false,seen:true},who);
assert.equal((await db.collection("users").doc(who.uid).get()).get("arrivals"),false);
console.log("PASS: Auth roles, uploads, moderation, catalog rules, analytics dedupe, concurrent checkout, repeat checkout, pricing, buyer privacy, sales, notifications, reviews, contact and preferences");
