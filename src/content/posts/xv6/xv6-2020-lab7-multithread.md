---
title: XV6-2020: LAB7-MULTITHREADING
published: 2025-06-28
description: "多线程真奇妙呀...等等这还是xv6吗！？"
image: "./lab7.jpg"
tags: ["xv6"]
category: OS
draft: false
---

# 前言
这个LAB有些特别呢，我们后面两个小作业都是在C标准库做的。就是说，这次我们不再用XV6的头文件，而是像学C初期时那样，直接用标准库哦！(ﾉ>ω<)ﾉ       

这个LAB有几个要改的文件，分别是：`user/uthread.c` `user/uthread_switch.S`、`notxv6/ph.c`和`notxv6/barrier.c`。        

# uthread: switching between threads (moderate)
第一个小作业呢，是要我们在一个进程内，模拟有好多小进程在跑。(づ′▽`)づ       
这些小进程是有名字的，叫做线程（threads）。       

读者们可能看过内核目录里的`swtch()` `struct context`之类的代码，LAB-3（pgtbl）那时候卡着的话，应该是肯定看过这些代码的吧？如果看过的话，这个小作业就很简单了！*ଘ(੭*ˊᵕˋ)੭* ੈ✩‧₊˚     

## 上下文的定义
首先我们要复制`kernel/proc.h`的`struct context`结构体！     

然后我们要粘贴到`user/uthread.c`：
```C
struct context {
  uint64 ra; // 这两个寄存器很重要哦
  uint64 sp; // 先记住，要用到的

  // callee-saved
  uint64 s0;
  uint64 s1;
  uint64 s2;
  uint64 s3;
  uint64 s4;
  uint64 s5;
  uint64 s6;
  uint64 s7;
  uint64 s8;
  uint64 s9;
  uint64 s10;
  uint64 s11;
};
```

之后在我们的结构体里添加一下：
```C
struct thread {
  char              stack[STACK_SIZE];  /* the thread's stack */
  int               state;              /* FREE, RUNNING, RUNNABLE */
  struct context    context;            /* 加上这个，空格要不要对齐都是可以的 */
};
```
这里表示，每个线程都有：    
- 栈（独立于进程的）
- 状态（看它是否空闲、在运行、可运行）
- 上下文（就是一些比较重要的寄存器）

## 切换上下文

然后我们现在就去`kernel/swtch.S`复制一下一段代码，然后无脑粘贴进`user/uthread_switch.S`就行了：
```C
thread_switch:
        /* YOUR CODE HERE */
        sd ra, 0(a0)
        sd sp, 8(a0)
        sd s0, 16(a0)
        sd s1, 24(a0)
        sd s2, 32(a0)
        sd s3, 40(a0)
        sd s4, 48(a0)
        sd s5, 56(a0)
        sd s6, 64(a0)
        sd s7, 72(a0)
        sd s8, 80(a0)
        sd s9, 88(a0)
        sd s10, 96(a0)
        sd s11, 104(a0)

        ld ra, 0(a1)
        ld sp, 8(a1)
        ld s0, 16(a1)
        ld s1, 24(a1)
        ld s2, 32(a1)
        ld s3, 40(a1)
        ld s4, 48(a1)
        ld s5, 56(a1)
        ld s6, 64(a1)
        ld s7, 72(a1)
        ld s8, 80(a1)
        ld s9, 88(a1)
        ld s10, 96(a1)
        ld s11, 104(a1)
        
        ret    /* return to ra */
```
这段代码的作用是：   
把旧线程的所有上下文保存起来，然后加载新线程的上下文。   

然后现在，我们把那个**extern**稍微修改一下：
```C
extern void thread_switch(struct context*, struct context*);
```

## 小修小补
现在呢，我们得稍微修一些函数，因为XV6故意留空了。    
不会很难的，就一个函数有点难度，读者们看看就懂了！   

### 调度
首先是上下文切换：
```C
void 
thread_schedule(void)
{
  struct thread *t, *next_thread;

  /* Find another runnable thread. */
  next_thread = 0;
  t = current_thread + 1;
  for(int i = 0; i < MAX_THREAD; i++){
    if(t >= all_thread + MAX_THREAD)
      t = all_thread;
    if(t->state == RUNNABLE) {
      next_thread = t;
      break;
    }
    t = t + 1;
  }

  if (next_thread == 0) {
    printf("thread_schedule: no runnable threads\n");
    exit(-1);
  }

  if (current_thread != next_thread) {         /* switch threads?  */
    next_thread->state = RUNNING;
    t = current_thread;
    current_thread = next_thread;
    /* YOUR CODE HERE
     * Invoke thread_switch to switch from t to next_thread:
     * thread_switch(??, ??);
     */
    thread_switch(&t->context, &next_thread->context);
  } else
    next_thread = 0;
}
```
这里调用`thread_switch()`是什么意思呢？    
其实就是把旧线程保存起来，然后加载新线程而已！    
就像`proc.c/scheduler`里的`swtch()`一样，只不过这个是用户态的，不过结构基本一模一样就是了   
ヾ(^▽^*)

为什么这个不难呢？   
因为它的提示给的太明显了，都告诉我们要调用什么了！   

### 新线程创建
这个就稍微有点难了，但是我刚刚给了读者们提示！   
就是**ra**和**sp**寄存器，这就是我们为数不多需要修改的东西了！   

```C
void 
thread_create(void (*func)())
{
  struct thread *t;

  for (t = all_thread; t < all_thread + MAX_THREAD; t++) {
    if (t->state == FREE) break;
  }
  t->state = RUNNABLE;
  // YOUR CODE HERE
  t->context.sp = (uint64)t->stack + STACK_SIZE;
  t->context.ra = (uint64)func;
}
```
为什么要改**sp**呢？   
因为每个**线程**都有自己的一块栈空间：
```C
char stack[STACK_SIZE];  /* the thread's stack */
```
在RISC-V和大部分其他主流架构中，栈都是从高地址往低地址增长的。    
而`stack`是一个数组，它的起始地址`&stack[0]`就是低地址，末尾`&stack[STACK-SIZE - 1]`就是高地址。    
所以我们要设置`sp`指向栈底（也就是高地址）：
```C
t->context.sp = (uint64)t->stack + STACK_SIZE;
```
这样`sp`就指向栈底了！    

那为什么又要修改**ra**呢？这玩意不返回地址嘛？    
确实，**ra**是返回地址，但是在这里有妙用！    
读者想想，当一个代码没有其他代码，只有一个**return**的话，会发生什么？    
呃呃...可能会报错，不过我们不管那个！在这里它的作用是直接前往那里！   
也就是说，线程一创建，指定**ra**后，它就会跑去`func()`那里了，它就能跑我们给他的函数，很厉害对吧？ヾ(´︶`*)ﾉ♬   

# using thread (moderate)
这个小作业是要修复BUG，做了刚刚的那道小作业，相信读者们已经对线程有个初步的认知了（没有的话现在学习去！( っ`-´c)ﾏ）。    

现在这个小作业，是要我们解决RACE CONDITION，因为某个变量可能被同时修改，或者修改前后读取之类的，这些是开发者不能完全控制的，即使可以，也不能保证其他人同样能控制，所以我们得用一个东西，叫锁（LOCK）。   
大概是有什么问题呢？    
就是当程序只有单线程时，那么程序就可以很好的运行。但是如果启用了多线程（比如2、4、8、10线程），就会报错，因为某些东西在错误的时间被错误的修改了。

这个小作业可能会需要你有这些知识：
- 哈希表
- 哈希表冲突的链式解决方案

## 解决方案
这个小作业是有两种解决方案的，第一种是性能至上，第二种是安全至上，博主选的是后者，前者是博主找SOLUTION时发现的可行方案（毕竟博主自己也没怎么用过`pthread.h`，所以还得查）。    
不过如果真要说的话，性能至上方案应该才是XV6希望我们用的，所以我会先教第一种。   

## 性能至上方案
读者们阅读代码后，应该会知道，`insert()`函数可能会大量的修改数据，毕竟只有它`malloc()`了：
```C
static void 
insert(int key, int value, struct entry **p, struct entry *n)
{
  struct entry *e = malloc(sizeof(struct entry));
  e->key = key;
  e->value = value;
  e->next = n;
  *p = e;
}
```

这样的话，我们只需要对调用`insert()`的地方进行就该就行了，就是同时只能有一个进程调用`insert()`。    

### 定义与实现
根据官方提示的话，我们可以用互斥锁（mutex），首先我们先定义锁，然后初始化它：
```C
// 全局变量
pthread_mutex_t lock;

// main函数
pthread_mutex_init(&lock, NULL);
```

### 上锁
然后我们在调用`insert()`之前上锁，返回之后解锁（真正叫做释放锁）就行了：
```C
static 
void put(int key, int value)
{
  int i = key % NBUCKET;

  // is the key already present?
  struct entry *e = 0;
  for (e = table[i]; e != 0; e = e->next) {
    if (e->key == key)
      break;
  }
  if(e){
    // update the existing key.
    e->value = value;
  } else {
    // the new is new.
    pthread_mutex_lock(&lock); // 上锁，这样就只有当前线程可以执行中间的指令了
    insert(key, value, &table[i], table[i]);
    pthread_mutex_unlock(&lock); // 释放锁
  }
}
```

这个方案很简单，而且在这里完全不会出错，可以说是完美方案了。（那当然，我大部分笔记也都是模仿这位whileskies大佬的，他实力还是很强的我觉得）

## 安全至上方案
这个是博主自己优化的（也可能是劣化？），说实话，不比上面的方案好多少就是了，不过如果想要额外学习读写锁的话，可以试试ヾ(•ω•`)o   

### 定义与实现
和之前的差不多，不过博主的方案得`for`循环：
```C
// 全局变量
pthread_rwlock_t lock[NBUCKET];

// main函数
for(int i = 0; i < NBUCKET; i++)
  pthread_rwlock_init(&lock[i], NULL);
```

### 上锁
博主自己上的锁比较多，这也是博主选择读写锁而不是互斥锁的原因，因为互斥锁禁止任何其他线程的读写，而读写锁可以只锁任意一个权限：
```C
static 
void put(int key, int value)
{
  int i = key % NBUCKET;

  // is the key already present?
  struct entry *e = 0;
  pthread_rwlock_rdlock(&lock[i]);
  for (e = table[i]; e != 0; e = e->next) {
    if (e->key == key)
      break;
  }
  pthread_rwlock_unlock(&lock[i]);

  if(e){
    // update the existing key.
    pthread_rwlock_wrlock(&lock[i]);
    e->value = value;
    pthread_rwlock_unlock(&lock[i]);
  } else {
    // the new is new.
    pthread_rwlock_wrlock(&lock[i]);
    insert(key, value, &table[i], table[i]);
    pthread_rwlock_unlock(&lock[i]);
  }
}
```

```C
static struct entry*
get(int key)
{
  int i = key % NBUCKET;

  struct entry *e = 0;
  pthread_rwlock_rdlock(&lock[i]);
  for (e = table[i]; e != 0; e = e->next) {
    if (e->key == key) break;
  }
  pthread_rwlock_unlock(&lock[i]);
  return e;
}
```

### 意外发现（废话小篇章）
博主发现呢，在LINUX上，对错误代码似乎更为宽容呢，一开始博主的初始化是这样写的：
```C
pthread_rwlock_init(&lock[NBUCKET], NULL);
```
这个初始化毫无疑问就是错的，它只会初始化一个锁，而且理论上来说都内存越界了，我也不知道当初怎么跑的通的。    
反正，这个初始化在博主的ARCH LINUX上是可以跑通的。    
但是由于博主的电脑最高就4核了（远古CPU i5-2520m），所以博主就和大哥借电脑，大哥的电脑是M4（苹果的那个SOC）的，可以跑10核。   
博主去自己的GitHub主页复制代码，用大哥的GCC（一开始是CLANG，大哥帮我换成GCC的）跑了，结果报SEGFAULT了，就是因为博主初始化错误的原因。

还是好奇怪呀，怎么ARCH LINUX能正常运行呢....

# barrier (moderate)
这个小作业要做的是：    
用一个名为`barrier()`的函数，拦截所有线程。   
直到所有线程到达时，才能继续跑。    

难度的话，没多难，毕竟只要写一个函数，读者们一看就懂！（我会解释的）

```C
static void 
barrier()
{
  // YOUR CODE HERE
  //
  // Block until all threads have called barrier() and
  // then increment bstate.round.
  //
  pthread_mutex_lock(&bstate.barrier_mutex);
  bstate.nthread++;
  if(bstate.nthread < nthread)
    pthread_cond_wait(&bstate.barrier_cond, &bstate.barrier_mutex);
  else{
    pthread_cond_broadcast(&bstate.barrier_cond);
    bstate.round++;
    bstate.nthread = 0;
  }
  pthread_mutex_unlock(&bstate.barrier_mutex);
}
```

这个代码的作用是：
- 线程进来时，先获取锁，防止过多的流量同时修改
- 记录这里有多一个受控的线程进来了
- 如果线程还没到齐：
  - 继续等，并释放锁（唤醒条件为*barrier_cond**，释放的锁为**barrier_mutex**）
- 如果线程全到齐了：
  - 唤醒所有条件为**barrier_cond**的线程
  - 被唤醒的线程重新获取锁
  - 记录跑了多一回合
  - 记录现在没有受控的线程了
- 之后，这些线程会依次释放锁

注：**broadcast**后，线程是依次执行的，谁快谁来，比较玄学，博主没怎么学过，了解不深。（；´д｀）ゞ   

# 完结撒花！
这个LAB的呀，博主觉得真的很有趣呢！   
因为是第一次在MIT6.S081用标准库做东西，和之前一直和`kernel/`打交道很不一样呢~   
这个LAB也让博主学到了好多关于线程的东西，比如RACE CONDITION、线程拦截等等(๑•̀ㅂ•́)و✧    

然后呢，博主的大哥和博主聊了一些关于RACE CONDITION的问题。    
大哥说：“有可能会出现多个线程同时拥有锁的情况，解决RACE CONDITION就是为了解决这个问题！”    
博主一开始吓了一跳呢！    
心想：诶？我们这个 LAB 难度有这么高吗？！Σ(っ °Д °;)っ    
后来查资料发现，那种“多个线程同时持有锁”的情况，一般只有分布式系统上才会出现。
至少我们这种“单机”的环境内，一般是不会发生这种事情的！ˋ( ° ▽、° ) 

而且`pthread`也很靠谱，只要我们好好写代码，就不会遇到那种高难BUG（后面的就不确定了，但是博主相信应该...也不会，博主还没看）

大哥可能是以为所有RACE CONDITION都是分布式系统那样的呢，不过那样和博主说的话，博主就自己把问题复杂化了，但是最后博主还是先去查了查才做LAB，这样就能提前知道这种环境是没有那种问题的了！（大哥坏）   

总之呢，这次大哥说的话让博主一度以为自己要写分布式系统啦，结果白吓一跳 (*ﾉωﾉ)
不过博主还是谢谢大哥，因为这样提前查资料也挺有收获的～嗯...虽然他差点把我带沟里，但他刚好前几天送了我一本原版 K&R 第二版（C语言圣经！），就原谅他啦！(〃´∀｀〃)ゞ

博主代码链接：https://github.com/aethernet65535/DOCKER-XV6_2020/tree/thread   
最后编辑时间：2025/6/30
