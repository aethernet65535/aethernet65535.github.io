---
title: "XV6-2020: LAB11-NET"
published: 2025-08-30
description: "游戏结束"
image: "./lab11.png"
tags: ["xv6"]
category: OS
draft: false
---


# 前言
这个就是最后的LAB了，不算特别难。   
只需要实现两个函数就行了，这可以让你对驱动开发有初步的认识。    
不过如果真想完全理解的话，可能就要精读手册和代码了。    

## 前置知识
- E1000_TXD_STAT_DD：
> - DD=0：网卡还没处理好
> - DD=1：已被网卡处理完毕

- E1000_TXT_CMD_RS（REPORT STATUS）：
> - RS=0：一定给你送过去，但是不会通知你（修改DD）
> - RS=1：一定送过去，也一定会通知你（修改DD）

- E1000_TXD_CMD_EOP（END OF PACK）：
> 一个包的结尾
> 如果一个包被才拆分为多个小包，那么只有最后一个需要打上EOP
> （不过我们这里不用）

- 以太网帧MTU：我们要发的数据，大小为1500
- 缓冲区（mbufs）：我们装数据的包，大小为2048
> 因为盒子（mbufs）比信封（MTU）大，所以不需要进行切割+多次发包（就像多卷压缩，限制单个包的大小）

- E1000_TDT：发；尾部
- E1000_RDT：收；尾部
> 理论上都为可复用块

## 实现
### 发包
`kernel/e1000.c`：
```C
int
e1000_transmit(struct mbuf *m) // 用户发来一个包
{
  // 获取锁
  acquire(&e1000_lock);

  int tail = regs[E1000_TDT]; // 看看尾部在哪

  // 如果尾部还在处理包
  if(!(tx_ring[tail].status & E1000_TXD_STAT_DD)){
    release(&e1000_lock); // 取消这次的发包
    return -1;
  }

  // 清理旧包的数据
  // 释放内存
  if(tx_mbufs[tail])
    mbuffree(tx_mbufs[tail]);

  // 打包新的包，为发包做准备

  // 清理残留数据
  // 因为我们这里并不会写入
  // 所有字段，所以要避免
  // 其他字段影响发包
  memset(&tx_ring[tail], 0, sizeof(struct tx_desc)); 
  tx_ring[tail].addr = (uint64)m->head;                       // 设置包地址
  tx_ring[tail].length = m->len;                              // 设置包长度（要发多少） 
  tx_mbufs[tail] = m;                                         // 把包放进去缓冲区
  tx_ring[tail].cmd = E1000_TXD_CMD_EOP | E1000_TXD_CMD_RS;   // 完成！


  // 类似regs[E1000_TDT]++
  // 但是更厉害
  // 就像一个环一样
  regs[E1000_TDT] = (tail+1) % TX_RING_SIZE;

  // 工作结束
  release(&e1000_lock);
  
  return 0;
}
```
看不懂的话，可以试试看一下这个翻译：    
1. 如果其他CPU没在这里工作，那就挂上「正在工作」的牌子（acquire）
2. 找到尾部（预期为空闲的桌子）
3. 如果这个桌子上还没放上「已完工」（DD=1），那就代表整个工作站都没有空闲桌子了，直接放工
4. 把桌子上的杂物拿走，确保桌子上没有其他的包（mbuffree）
5. 一键格式化桌子上面的通信机器（memset 0）
6. 给机器设置地址，让远边的发货员知道货物放在哪（addr）
7. 给机器设置包大小，让收货方能更好的判断是不是自己的货（length）
8. 把包放到桌子上（mbuf）
9. 在机器上按下两个按钮：已经把所有东西都放好了+做好了记得记录！（cmd）
10. 然后按下最后一个按钮：这里要处理！
11. 按下后，尾部就会自动变成下一个，可能会是另一个空闲的桌子
12. 拿掉牌子，去做别的工作（release）

### 收包
`kernel/e1000.c`：
```C
void
e1000_init(uint32 *xregs)
{
/* ... */
  initlock(&e1000_lockrx, "e1000_rx");
/* ... */
}
```

```C
static void
e1000_recv(void)
{
  acquire(&e1000_lockrx);

  // TAIL++
  int i = (regs[E1000_RDT]+1) % RX_RING_SIZE;

  // 当这个包收到了数据
  while(rx_ring[i].status & E1000_RXD_STAT_DD){
    rx_mbufs[i]->len = rx_ring[i].length;
    struct mbuf *rb = rx_mbufs[i];

    // &rb != &rx_mbufs[i], 地址不相同
    // 前者为接收到的缓冲包
    // 后者为新缓冲包
    rx_mbufs[i] = mbufalloc(0);

    if(!rx_mbufs[i])
      panic("e1000_recv: alloc");

    rx_ring[i].addr = (uint64)rx_mbufs[i]->head; // 把新缓冲包丢进去环内
    rx_ring[i].status = 0;                       // 设置为未使用
    regs[E1000_RDT] = i;                         // 更新尾部

    // 这个函数会自动找到谁在请求这个包
    // 然后发过去！
    net_rx(rb);

    // TAIL++
    i = (regs[E1000_RDT]+1) % RX_RING_SIZE;
  }
  release(&e1000_lockrx);
}
```
JOJOの奇妙比喻：    
1. 先查看可能为要处理的桌子在哪
2. 去哪检那桌子上有没有货（错误=退出）
3. 看看上游说这个货有多大，然后写在纸条贴上盒子
4. 然后在纸条上写上：我收到的包是XXX（rx_mbufs[i]），记录用
5. 把新盒子放到桌子上（没新盒子就炸了）
6. 把新盒子的地点写到机器上，方便接收员找
7. 在机器上写入：这个桌子上的盒子是空的
8. 在机器上更新：最后一个空闲桌子在XX号（regs[E1000_RDT] = i）
9. 带上刚刚记录的那个盒子，走去本地接收站
10. 把盒子给前台，然后这轮工作就结束了（net_rx(rb)）
11. 去看看下一个桌子有没有新货
12. 没有的话就可以跑了！

# 完结撒花ヾ(≧▽≦*)o
这就是最后一个LAB了，做好后，你就可以把XV6的事情丢一旁，去干自己的事情了。    
这个LAB...确实让我对网卡有个初步的了解了，
不过初始化之类的代码我没认真读，读者们厉害的话可以尝试读读这些代码，
说不定会因此变得更厉害呢！    

楼主用了差不多4个月来做完XV6的所有LAB，不单单只是抄，抄了后也有努力让自己去理解，
写博客就是其中一个强制自己去理解的途径。    
如果读者们对计算机感兴趣的话，希望读者们也可以努力理解自己实现了什么，让之后的路更好走。    

之后博主打算去学习安卓和LINUX内核，可能会先尝试LINUX，楼主至始至终的目标都是让手机的续航更好，
之后可能也会折腾驱动相关的事情，因为我印象中最影响手机续航的其中一个大因素就是驱动，
或者说，LINUX的调度本身就很好了，不需要过多的干预。

总而言之，祝读者们好运，每天进步，无限进步，比昨天的自己更好，变成自己想成为的人！    
(≧∀≦)ゞ

最后编辑时间：2025/8/30
