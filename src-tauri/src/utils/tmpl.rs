//! Some config file template

/// template for new a profile item
pub const ITEM_LOCAL: &str = "# Profile Template for Clash Verge

proxies: []

proxy-groups: []

rules: []
";

/// enhanced profile
pub const ITEM_MERGE: &str = "# Profile Enhancement Merge Template for Clash Verge

profile:
  store-selected: true
";

pub const ITEM_MERGE_EMPTY: &str = "# Profile Enhancement Merge Template for Clash Verge

";

/// enhanced profile
pub const ITEM_SCRIPT: &str = "// Define main function (script entry)

function main(config, profileName) {
  return config;
}
";

/// enhanced profile
pub const ITEM_RULES: &str = r"prepend:
  - 'DOMAIN,api.synaglobal.vip,JMS'
  - 'DOMAIN-SUFFIX,synaglobal.vip,JMS'
  - 'DOMAIN,localhost,DIRECT'
  - 'DOMAIN-SUFFIX,local,DIRECT'
  - 'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve'
  - 'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve'
  - 'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve'
  - 'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve'
  - 'IP-CIDR6,::1/128,DIRECT,no-resolve'
  - 'IP-CIDR6,fc00::/7,DIRECT,no-resolve'
  - 'IP-CIDR6,fe80::/10,DIRECT,no-resolve'
  - 'IP-CIDR,47.254.123.106/32,DIRECT,no-resolve'
  - 'GEOSITE,baidu,DIRECT'
  - 'DOMAIN-SUFFIX,baidu.com,DIRECT'
  - 'DOMAIN-SUFFIX,baidu.com.cn,DIRECT'
  - 'DOMAIN-SUFFIX,baidu.cn,DIRECT'
  - 'DOMAIN-SUFFIX,baidubce.com,DIRECT'
  - 'DOMAIN-SUFFIX,baidupcs.com,DIRECT'
  - 'DOMAIN-SUFFIX,baidustatic.com,DIRECT'
  - 'DOMAIN-SUFFIX,bdstatic.com,DIRECT'
  - 'DOMAIN-SUFFIX,bcebos.com,DIRECT'
  - 'DOMAIN-SUFFIX,bdimg.com,DIRECT'
  - 'DOMAIN-SUFFIX,baidupan.com,DIRECT'
  - 'DOMAIN-SUFFIX,tieba.com,DIRECT'
  - 'DOMAIN-KEYWORD,baidu,DIRECT'
  - 'GEOSITE,jd,DIRECT'
  - 'DOMAIN-SUFFIX,jd.com,DIRECT'
  - 'DOMAIN-SUFFIX,jd.cn,DIRECT'
  - 'DOMAIN-SUFFIX,jd.hk,DIRECT'
  - 'DOMAIN-SUFFIX,jdpay.com,DIRECT'
  - 'DOMAIN-SUFFIX,jdcloud.com,DIRECT'
  - 'DOMAIN-SUFFIX,jcloud.com,DIRECT'
  - 'DOMAIN-SUFFIX,360buy.com,DIRECT'
  - 'DOMAIN-SUFFIX,360buyimg.com,DIRECT'
  - 'DOMAIN-SUFFIX,jingdong.com,DIRECT'
  - 'DOMAIN-SUFFIX,jingxi.com,DIRECT'
  - 'DOMAIN-SUFFIX,yihaodian.com,DIRECT'
  - 'DOMAIN-SUFFIX,yhd.com,DIRECT'
  - 'DOMAIN-SUFFIX,3.cn,DIRECT'
  - 'DOMAIN-KEYWORD,jdcloud,DIRECT'
  - 'DOMAIN-KEYWORD,jcloud,DIRECT'
  - 'GEOSITE,alibaba,DIRECT'
  - 'DOMAIN-SUFFIX,taobao.com,DIRECT'
  - 'DOMAIN-SUFFIX,tmall.com,DIRECT'
  - 'DOMAIN-SUFFIX,tmall.hk,DIRECT'
  - 'DOMAIN-SUFFIX,alibaba.com,DIRECT'
  - 'DOMAIN-SUFFIX,alibabausercontent.com,DIRECT'
  - 'DOMAIN-SUFFIX,alipay.com,DIRECT'
  - 'DOMAIN-SUFFIX,alipay.cn,DIRECT'
  - 'DOMAIN-SUFFIX,alicdn.com,DIRECT'
  - 'DOMAIN-SUFFIX,mmstat.com,DIRECT'
  - 'DOMAIN-SUFFIX,tbcdn.cn,DIRECT'
  - 'DOMAIN-SUFFIX,taobaocdn.com,DIRECT'
  - 'DOMAIN-SUFFIX,goofish.com,DIRECT'
  - 'DOMAIN-SUFFIX,xiami.com,DIRECT'
  - 'DOMAIN-KEYWORD,taobao,DIRECT'
  - 'DOMAIN-KEYWORD,tmall,DIRECT'
  - 'DOMAIN-SUFFIX,quark.cn,DIRECT'
  - 'DOMAIN-SUFFIX,myquark.cn,DIRECT'
  - 'DOMAIN-KEYWORD,quark,DIRECT'
  - 'DOMAIN-SUFFIX,uc.cn,DIRECT'
  - 'DOMAIN-SUFFIX,ucweb.com,DIRECT'
  - 'DOMAIN-SUFFIX,aliyun.com,DIRECT'
  - 'DOMAIN-SUFFIX,aliyuncs.com,DIRECT'
  - 'DOMAIN-SUFFIX,alicdn.com,DIRECT'
  - 'DOMAIN-SUFFIX,bilibili.com,DIRECT'
  - 'DOMAIN-SUFFIX,bilivideo.com,DIRECT'
  - 'DOMAIN-SUFFIX,bilivideo.cn,DIRECT'
  - 'DOMAIN-SUFFIX,qq.com,DIRECT'
  - 'DOMAIN-SUFFIX,bigmodel.cn,DIRECT'
  - 'DOMAIN-SUFFIX,xfyun.cn,DIRECT'
  - 'DOMAIN-SUFFIX,xf-yun.com,DIRECT'
  - 'DOMAIN,hif-dliq.deepseek.com,JMS'
  - 'DOMAIN-SUFFIX,deepseek.com,DIRECT'
  - 'DOMAIN-SUFFIX,xiaomimimo.com,DIRECT'
  - 'DOMAIN-SUFFIX,vvic.com,DIRECT'
  - 'DOMAIN-SUFFIX,vip.com,DIRECT'
  - 'DOMAIN-SUFFIX,appsimg.com,DIRECT'
  - 'DOMAIN-SUFFIX,oray.com,DIRECT'
  - 'DOMAIN-SUFFIX,oray.net,DIRECT'
  - 'DOMAIN-SUFFIX,oray.cn,DIRECT'
  - 'DOMAIN-SUFFIX,orayimg.com,DIRECT'
  - 'DOMAIN-SUFFIX,sunlogin.com,DIRECT'
  - 'DOMAIN-SUFFIX,sunlogin.net,DIRECT'
  - 'DOMAIN-KEYWORD,oray,DIRECT'
  - 'DOMAIN-KEYWORD,sunlogin,DIRECT'
  - 'GEOSITE,douyin,DIRECT'
  - 'DOMAIN-SUFFIX,douyin.com,DIRECT'
  - 'DOMAIN-SUFFIX,douyincdn.com,DIRECT'
  - 'DOMAIN-SUFFIX,douyinpic.com,DIRECT'
  - 'DOMAIN-SUFFIX,douyinstatic.com,DIRECT'
  - 'DOMAIN-SUFFIX,douyinvod.com,DIRECT'
  - 'DOMAIN-SUFFIX,idouyinvod.com,DIRECT'
  - 'DOMAIN-SUFFIX,iesdouyin.com,DIRECT'
  - 'DOMAIN-SUFFIX,amemv.com,DIRECT'
  - 'DOMAIN-SUFFIX,snssdk.com,DIRECT'
  - 'DOMAIN-SUFFIX,pstatp.com,DIRECT'
  - 'DOMAIN-SUFFIX,toutiao.com,DIRECT'
  - 'DOMAIN-SUFFIX,ixigua.com,DIRECT'
  - 'DOMAIN-SUFFIX,qishui.com,DIRECT'
  - 'DOMAIN-SUFFIX,qishui.cn,DIRECT'
  - 'DOMAIN-SUFFIX,qishuimusic.cn,DIRECT'
  - 'DOMAIN-SUFFIX,qishuimusic.com.cn,DIRECT'
  - 'DOMAIN-KEYWORD,qishui,DIRECT'
  - 'DOMAIN-KEYWORD,douyin,DIRECT'
  - 'DOMAIN-SUFFIX,bytecdn.cn,DIRECT'
  - 'DOMAIN-SUFFIX,bytecdn.com,DIRECT'
  - 'DOMAIN-SUFFIX,bytecdntp.com,DIRECT'
  - 'DOMAIN-SUFFIX,byteimg.com,DIRECT'
  - 'DOMAIN-SUFFIX,byteacctimg.com,DIRECT'
  - 'DOMAIN-SUFFIX,bytescm.com,DIRECT'
  - 'DOMAIN-SUFFIX,bytetos.com,DIRECT'
  - 'DOMAIN-SUFFIX,volccdn.com,DIRECT'
  - 'DOMAIN-SUFFIX,volces.com,DIRECT'
  - 'DOMAIN-SUFFIX,bytedance.com,DIRECT'
  - 'DOMAIN-SUFFIX,bytedance.net,DIRECT'
  - 'DOMAIN-SUFFIX,bytedns.com,DIRECT'
  - 'DOMAIN-SUFFIX,bytedns.net,DIRECT'
  - 'DOMAIN-SUFFIX,zijieapi.com,DIRECT'
  - 'DOMAIN-SUFFIX,ibytedapm.com,DIRECT'
  - 'DOMAIN-KEYWORD,zijie,DIRECT'
append: []
delete:
  - 'GEOIP,CN,DIRECT'
  - 'GEOIP,CN,DIRECT,no-resolve'
";

/// enhanced profile
pub const ITEM_PROXIES: &str = "# Profile Enhancement Proxies Template for Clash Verge

prepend: []

append: []

delete: []
";

/// enhanced profile
pub const ITEM_GROUPS: &str = "# Profile Enhancement Groups Template for Clash Verge

prepend: []

append: []

delete: []
";
