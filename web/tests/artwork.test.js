const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../dist/orbital-customer.js'),'utf8');
const context={window:{},URL,location:{href:'http://localhost/web/',origin:'http://localhost'}};
vm.createContext(context);
vm.runInContext(code.slice(code.indexOf('  window.OrbitalArtwork ='),code.indexOf('  window.OrbitalEdition =')),context);
const art=context.window.OrbitalArtwork;
test('connected artwork accepts secure providers and own-server images',()=>{
 assert.equal(art.url('https://www.thesportsdb.com/images/team/badge/test.png'),'https://www.thesportsdb.com/images/team/badge/test.png');
 assert.equal(art.url('/art/team.png'),'http://localhost/art/team.png');
 for(const value of ['javascript:alert(1)','data:image/svg+xml,example','https://user:password@example.com/a','http://external.example/a','https://example.com/a#fragment'])assert.equal(art.url(value),'');
});
test('connected team logo wins over optional legacy map, absent artwork retains initials',()=>{
 context.window.OrbitalTeamArt={'MLB|Example':{url:'https://old.example/team.png',abbr:'EX'}};
 assert.equal(art.team({league:'MLB'},{name:'Example',logo:'https://new.example/logo.png'}).url,'https://new.example/logo.png');
 assert.equal(art.team({league:'MLB'},{name:'Unknown',abbreviation:'UNK'}).url,'');
 assert.equal(art.team({league:'MLB'},{name:'Unknown',abbreviation:'UNK'}).abbr,'UNK');
});
