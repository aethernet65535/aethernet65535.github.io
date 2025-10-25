---
title: "XV6-2020: LAB8-LOCK"
published: 2025-07-06
description: "锁住资源！"
image: "./lab8.jpg"
tags: ["xv6"]
category: OS
draft: false
---

# 前言
这个LAB...第一个和第二个的难度差距有点大，第一个挺简单，第二个难的离谱（；´д｀）ゞ      

这个LAB主要是让我们学习到了锁与性能的关系，降低锁的粒度，以此获得更好的性能。       
学到的东西也不算少，可以说这LAB和我们上一个LAB的关系还挺大的，都挺好玩的，不过不这个难度确实大不少呢。      
简单点来说的话，就是增加程序的并行性，使其的串行性更低，以此获得更好的多核/多线程（这LAB倒是没多线程）性能，虽然现在的CPU单核也很强（我记得苹果的SOC单核超级强），但是多核性能也是可以大大增加使用体验的，相信读者们使用pthread.h时也能很明显的感觉到。

这个LAB还有一部分是为下一个LAB（FILE SYSTEM）做热身，我目前还没怎么读，估计明天就会开始读了，不然我压根理解不了呢我觉得。

# memory allocator (moderate)
第一个要改的是`kalloc.c`，这个相对简单，可以说和上一个LAB的某个小作业差不多。       

## 问题
首先我们先来看看“为什么要改”：
现在`kalloc()`和`kfree()`有一些问题，就是在多核情况下，会有锁竞争问题，倒不是会影响结果，只是会大幅影响性能。       
就是同时只能有一个CPU调用这些函数，我们需要改一下，让这些函数可以同时被多个CPU调用和运行。

## 工作
我们的工作是要让每个CPU都有自己的freelist，并且在自己的freelist为空时，窃取其他CPU的空闲页。        
自然的，锁的数量也得增加，官方有个规定：锁的名字必须以“kmem”开头。      
只要`kalloctest`能完美通过，那就是通过此测试！(｡･∀･)ﾉﾞ

## 提示
官方倒是有给些提示，我总结了一些较为重要的提示：
- 关于**CPU**有多少个的问题，其实用`kernel/param.h`的**NCPU**就好了，不用太在意XV6上有多少CPU
- 让`freerange()`把所有空闲页分配给正在运行的CPU（博主猜测大概率是**CPU 0**，不过这种技术细节先不用太在意）
- 你可以使用`pop_off()`和`push_off()`来控制中断的**开关**
- `cpuid()`会返回当前CPU核心编号
- 可以试试`snprintf()`来对每个锁命名，不过要每个都叫**kmem**也不是不行

## 实现
首先，我们要先升级一下freelist，从本来的全局版升级为多核独立版。        
锁也要对应的增加一下，然后别忘了给锁命名。      
```C
#define LOCKLEN 6 // 锁名长度限制

struct run {
  struct run *next;
};

struct {
  struct spinlock lock;
  char lock_name[LOCKLEN]; 
  struct run *freelist;
} kmem[NCPU];

void
kinit()
{
  for(int i = 0; i < NCPU; i++){ // 循环锁的初始化
    snprintf(kmem[i].lock_name, LOCKLEN, "kmem %d", i);
    initlock(&kmem[i].lock, kmem[i].lock_name);
  }
  freerange(end, (void*)PHYSTOP);
}
```

这个小作业最难的就是这里的，因为我们要在原版的基础上加上一个窃取机制。      
要注意的是，我们得关闭中断，以确保我们获得的CPUID在执行时是正确的。     
然后我们还得把freelist改为对应的CPU核心编号。
```C
void *
kalloc(void)
{
  struct run *r;

  push_off(); // 关闭中断
  int cpu = cpuid();
  acquire(&kmem[cpu].lock);
  r = kmem[cpu].freelist;
  if(r){
    kmem[cpu].freelist = r->next;
    release(&kmem[cpu].lock);
  }else{
    // 本地没空闲页也得释放，避免死锁
    release(&kmem[cpu].lock);

    // 窃取空闲页（遍历法）
    // 从其他CPU的FREELIST
    for(int nextid = 0; nextid < NCPU; nextid++){
      if(cpu != nextid){
        acquire(&kmem[nextid].lock);
        r = kmem[nextid].freelist;

        if(r){
          kmem[nextid].freelist = r->next;
          release(&kmem[nextid].lock);
          break;
        }

        release(&kmem[nextid].lock);
      }
    }
  }
  pop_off(); // 开启（也有可能不开启，具体去看源代码）中断

  if(r)
    memset((char*)r, 5, PGSIZE); // fill with junk
  return (void*)r;
}
```

这个的话相对简单，只要把释放的空闲页插到对应CPU的链表头就好了，这玩意的不严谨性应该给窃取机制的使用次数降低了不少呢（＞人＜；）。
```C
void
kfree(void *pa)
{
  struct run *r;

  if(((uint64)pa % PGSIZE) != 0 || (char*)pa < end || (uint64)pa >= PHYSTOP)
    panic("kfree");

  // Fill with junk to catch dangling refs.
  memset(pa, 1, PGSIZE);

  r = (struct run*)pa;

  push_off();
  int cpu = cpuid();
  acquire(&kmem[cpu].lock);
  r->next = kmem[cpu].freelist;
  kmem[cpu].freelist = r;
  release(&kmem[cpu].lock);
  pop_off();
}
```

### 中断 - 为什么中断？    
中断到开启中断之间的这一个中间过程，好像是会让中间的这段代码不会被其他CPU执行，也就是说只会被当前CPU独占的代码，其他CPU在这一段时间内不可运行（中断后应该就可以了），可能听起来有点复杂，但是意思差不多就是：    
> 中断后，之后的代码就是能由一个CPU运行了。

#### 为什么不是intr_on()/off()
这个...有点难说，主要是因为有时候我们并不希望马上结束中断，内核代码也有不少地方是用pop/pop_off()代替的。我们使用的这种中断开关是有一种比较特殊的东西的，是类似计数器（不是PC计数器之类的，就是count计数而已，叫做noff，每个CPU不共享/独有的），它会记录我们调用了多少次开启中断，多少次关闭中断，只有0的时候才会真正开启中断。



# buffer cache (hard)
这个确实不简单，也比上一个难，具体难是在这里：    
在第一个小作业，我们要做的只是分配页，只要是freelist里的基本上都没问题。     
但是buffer cache的话，读者可以暂时把它理解为一个文件（真正可能是一部分文件，但是这里就把它理解为一整个文件就行了）。系统总不可能随便拿一个文件分给用户，肯定是要拿用户想要的那个文件给用户呀，所以不能简单的用分开CPU的方式来解决锁竞争问题。

## 问题
和上一个的差不多，就是xv6只用了一个锁来保护所有buffer cache。    
> 之后我可能会用“（内存上的）文件”来帮简称，易于理解，但是真正肯定不是这种名字。    

这样，CPU foo要读取“甲”文件，而CPU bar要读取“乙”文件。    
照xv6的方法，在CPU foo读取成功之前，CPU bar压根不可能读取到，但是我们解决后就“可能”可以了。

### 提示
- 可以使用哈希表来降低锁的粒度。
- 哈希表数组长度可以选择质数或2的幂次方，以降低哈希冲突的可能性，或加速查找运算。
- 不再使用bcache.head。
> 你可能会好奇“那要怎么做LRU遍历呢？”，其实答案很简单，现在的是怎么样的？最后面的就是最少使用的？嗯...要这样说也没错啦，但是这样的话就会导致`brelse()`变得有些复杂呢。所以xv6给我想了一个更好的解决方法，使用ticks，就是看谁的ticks最小，那它就是最少用的，这样就能很好的避免复杂化`brelse()`了（虽然会导致`bget()`变得复杂就是了｡⁠:ﾟ⁠(⁠;⁠´⁠∩⁠\`;⁠)ﾟ⁠:⁠｡）
- 可以使用全局锁`bcache.head`，但是仅限调试用，成品不能使用该全局锁。

## 解决方案
### 结构体修改
首先，我们要先给缓存的结构体，添加一个可以对比各个缓存最后运行时间的字段。
```C
struct buf {
  int valid;   // has data been read from disk?
  int disk;    // does disk "own" buf?
  uint dev;
  uint blockno;
  struct sleeplock lock;
  uint refcnt;
  struct buf *prev; // LRU cache list
  struct buf *next;
  uchar data[BSIZE];

  uint ticks; // 添加这个
};
```

### 哈希
先定义一下我们要多少个哈希桶，我选的16，因为是2的幂次方。   
13、17之类的也是个不错的选择，由于是质数，所以可以降低哈希冲突的概率。    
定义在哪的话...在`bio.c`或`param.h`，甚至是其他奇怪的地方，基本都是可以的：
```C
#define NBUC 16
```

现在，我们要把原本的数据结构改为哈希表，因为这样就能降低锁的力度，进而降低竞争的激烈性。
用不到的字段删了就行，这样用了就会在编译时报错，编译时报错会更好：
```C
struct {
  
  // 在这LAB用不到这些字段了
  /*  
  struct buf head;
  struct spinlock lock;
  */

  struct buf buf[NBUF];

  // 哈希表
  struct buf buc[NBUC];
  struct spinlock buc_lock[NBUC];

  // 新全局列表
  struct spinlock glb_lock[NBUC];
} bcache;
```

#### 哈希运算
关于哈希的索引运算，有两种方法，取决于读者们选择了多少哈希桶数量。

如果是2的幂次方如4、8、16之类的，可以使用与运算。
```C
#define HASHI(noblock) (noblock & (NBUC - 1)) 
```
如果是非2的幂次方，那直接取模就完啦！
```C
#define HASHI(noblock) (noblock % NBUC)
```

#### 初始化
`binit()`我们得稍微改一下，我们先看看原本的：
```C
void
binit(void)
{
  struct buf *b;

  initlock(&bcache.lock, "bcache");

  // Create linked list of buffers
  bcache.head.prev = &bcache.head;
  bcache.head.next = &bcache.head;
  for(b = bcache.buf; b < bcache.buf+NBUF; b++){
    b->next = bcache.head.next;
    b->prev = &bcache.head;
    initsleeplock(&b->lock, "buffer");
    bcache.head.next->prev = b;
    bcache.head.next = b;
  }
}
```
看代码能发现，只创建了一个锁，也是全局锁。    

那我们就照葫芦画瓢，修一下：
```C
void
binit(void)
{
  struct buf *b;
  int i;

  for(i = 0; i < NBUC; i++){
    initlock(&bcache.buc_lock[i], "bcache.buc");
    initlock(&bcache.glb_lock[i], "bcache.glb");

    bcache.buc[i].next = &bcache.buc[i];
    bcache.buc[i].prev = &bcache.buc[i];
  }

  // 初始化哈希表
  // 头插入法
  for(b = bcache.buf; b < bcache.buf+NBUF; b++){
    int x = HASHI(b->blockno);

    b->next = bcache.buc[x].next;
    b->prev = &bcache.buc[x];

    bcache.buc[x].next->prev = b;
    bcache.buc[x].next = b;

    b->ticks = ticks;

    initsleeplock(&b->lock, "buffer");
  }
}
```

### LRU算法
函数的代码有点长，我先大致说一下这个代码都是做什么的。    
大致上的流程就是：
> 1. 进入大临界区。
> 2. 查找该数据对应的缓存块是否存在，如果存在直接返回，如果不存在则继续。
> 3. 查找没有被占用且最久没被使用的缓存块，完全找不到就panic，找到了就继续。
> 4. 如果找到的块不在用户想要的哈希桶内，则转移。
> 5. 初始化，并返回给调用方。
```C
static struct buf*
bget(uint dev, uint blockno)
{
  struct buf *b;
  int x = HASHI(blockno);

  // 从这里开始
  acquire(&bcache.glb_lock[x]);

  // 要找的块有没有缓存了？
  acquire(&bcache.buc_lock[x]);
  for(b = bcache.buc[x].next; b != &bcache.buc[x]; b = b->next){
    if(b->dev == dev && b->blockno == blockno){
      b->refcnt++;
      release(&bcache.buc_lock[x]);
      release(&bcache.glb_lock[x]);
      acquiresleep(&b->lock);
      return b;
    }
  }
  // 还没呢
  release(&bcache.buc_lock[x]);

  // LRU的必要变量初始化
  struct buf *minb = 0;
  // 这里的作用是，mticks = 最大值，非0就是0xFFFF...（就是全是F）
  uint mticks = ~0;

  // 遍历所有桶
  for(int i = 0; i < NBUC; i++){
    acquire(&bcache.buc_lock[i]);
    int find = 0;
    
    // 找到最近用的最少的块
    for(b = bcache.buc[i].next; b != &bcache.buc[i]; b = b->next){
      if(b->refcnt == 0 && b->ticks < mticks){
        if(minb != 0){
          int last = HASHI(minb->blockno);
          if(last != i)
            release(&bcache.buc_lock[last]);
        }
        mticks = b->ticks;
        minb = b;
        find = 1;
      }
    }
    // 当前桶内没空闲的块
    if(!find)
      release(&bcache.buc_lock[i]);
  }

  // 完了，完全没有空闲块
  if(minb == 0)
    panic("bget: no buffers");

  int minb_x = HASHI(minb->blockno);

  minb->dev = dev;
  minb->blockno = blockno;
  minb->valid = 0;
  minb->refcnt = 1;

  // 如果找到的空闲块
  // 不在用户想要的桶内
  // 那就移动去调用方想要的桶

  // 这里只是把那个空闲块移出去
  if(minb_x != x){
    minb->prev->next = minb->next;
    minb->next->prev = minb->prev;
  }
  release(&bcache.buc_lock[minb_x]);

  // 这里用的是头插入法
  // 把那个空闲块放进调用方想要的桶
  if(minb_x != x){
    acquire(&bcache.buc_lock[x]);

    minb->next = bcache.buc[x].next;
    minb->prev = &bcache.buc[x];
    bcache.buc[x].next->prev = minb;
    bcache.buc[x].next = minb;

    release(&bcache.buc_lock[x]);
  }
  
  // 在这里结束
  release(&bcache.glb_lock[x]);
  acquiresleep(&minb->lock);
  return minb;
}
```
现在，看完代码的你，可能并不完全理解这函数是干什么的。        
这些可能会有助于你理解这段函数：    
- `bcache.glb_lock[NBUC]`是一个**桶级全局锁**，它在`bget()`的大部分执行过程中被持有。它的主要作用类似我们之前的全局锁，但是之前的全局锁是真的全局，这个是桶级全局。
- `bcache.buc_lock[NBUC]`是一个**哈希桶链表锁**，它的作用范围更小，在`glb_lock`保护的大临界区内，当需要对哈希桶内部的链表结构（如遍历、插入节点）进行操作时，就会使用`buc_lock`来保护链表，避免并发修改导致链表损坏。
- 不过其实这两个锁本质都是一样的，你要直接把这两个锁交换来用都行，你不混着用就好了。
- `b->lock`是每个缓存块各有的锁，为了保护其数据，`bget()`在返回缓存块前，会先给该缓存块获取锁。

### brelse的简化
我们先看看原本的brelese是干什么的：
```C
void
brelse(struct buf *b)
{
  if(!holdingsleep(&b->lock))
    panic("brelse");

  releasesleep(&b->lock);

  acquire(&bcache.lock);
  b->refcnt--;
  if (b->refcnt == 0) {
    // no one is waiting for it.
    b->next->prev = b->prev;
    b->prev->next = b->next;
    b->next = bcache.head.next;
    b->prev = &bcache.head;
    bcache.head.next->prev = b;
    bcache.head.next = b;
  }
  
  release(&bcache.lock);
}
```
作用就是：
1. 确认持有该块的睡眠锁：
- 没有就panic
- 持有就释放掉锁
2. 获取全局锁
3. 给引用次数-1
4. 如果不再使用该块了：
- 移动到块链表头部
5. 不管有没有执行`4`，都会释放锁

这个函数对我们来说已经没有用了，或者说它的逻辑错误，原因为以下几点：
- 我们已经不使用`bcache.lock`作为全局锁了
- 我们已经不使用`bcache.head`作为头节点了
- 我们已经不使用单链表进行块管理了

所以我们得稍微改改：
```C
void
brelse(struct buf *b)
{
  if(!holdingsleep(&b->lock))
    panic("brelse");

  releasesleep(&b->lock);

  int x = HASHI(b->blockno);
  acquire(&bcache.buc_lock[x]);
  b->refcnt--;
  if (b->refcnt == 0)
    b->ticks = ticks;
  release(&bcache.buc_lock[x]);
}
```
我们用了更简单的方法，就是改`ticks`而已，
毕竟我们的LRU就是遍历找`ticks`而已嘛，
`brelse()`的一部分可以说是为`bget()`的LRU算法服务的。

### bpin/bunpin的调整
这个就没什么简化了，只是调整而已，一样的，先上原本的：
```C
void
bpin(struct buf *b) {
  acquire(&bcache.lock);
  b->refcnt++;
  release(&bcache.lock);
}

void
bunpin(struct buf *b) {
  acquire(&bcache.lock);
  b->refcnt--;
  release(&bcache.lock);
}
```
和刚刚的差不多，就只是因为`bcache.lock`现在不能用了而已，
所以我们要改成`bcache.buc_lock[NBUC]`的版本呢。

```C
void
bpin(struct buf *b) {
  int x = HASHI(b->blockno);

  acquire(&bcache.buc_lock[x]);
  b->refcnt++;
  release(&bcache.buc_lock[x]);
}

void
bunpin(struct buf *b) {
  int x = HASHI(b->blockno);

  acquire(&bcache.buc_lock[x]);
  b->refcnt--;
  release(&bcache.buc_lock[x]);
}
```
这个就不过多解释了，基本没什么理解难度。



## 其他问题    
Q：ticks会不会溢出，多久？    
A：会，不过**有点**慢，大概要13年左右。   
> 我稍微解释下，xv6的1ticks是0.1秒，也就是说，一秒有10ticks。所以要这样算：   
> (2^32 - 1) ÷ 10 ≈ 429,496,729s    
> 429,496,729s ÷ 60 ≈ 119,306h    
> 119,306 ÷ 24 ≈ 4971d    
> 4971d ÷ 356 ≈ 13y   
要是从32位进化到64位，更不敢想了吧，天文数字了。    

# 完结撒花 ψ(._. )>
这个其实还挺有难度的，死锁之类的，还有一些并发问题，很难，不过也很好玩，因为并发并行这些东西是在很多领域的适用的。虽然我听说好像有很多高级语言都有自带多线程，甚至不需要程序员干预。但是，读者们会来学XV6，我想多多少少还是希望了解计算机的。

总之，加油吧！屏幕前的所有读者！

仓库链接：https://github.com/aethernet65535/DOCKER-XV6_2020/tree/lock

最后编辑时间：2025/7/21

