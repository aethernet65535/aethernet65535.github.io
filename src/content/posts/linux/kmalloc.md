---
title: "小对象分配与释放：kmalloc()/kfree()"
published: 2025-10-24
description: "开始学习Linux内存管理吧"
image: "./kmalloc.png"
tags: ["Memory Management", "Linux"]
category: Kernel
draft: false
---

# 前言
好久没写博客了，回来写写练练手。

## 状态
现在在学习的是Linux的内存管理，因为我觉得内存管理应该是操作系统中一个很重要的东西，毕竟计算机最重要的两个硬件就是CPU和内存嘛，虽然文件系统也很重要就是了，不过我觉得有点太难了，所以先不学。
博主现在水平...还算是个刚入门不久的新手吧，刚学变成9个月。

## 内核版本
啊对了，我正在学的是Linux 5.10.245的版本，要问为什么不是最新版的话，主要是因为最新版更容易有改动，而且就是，我感觉5.10比较好读，而且不算太老，好多安卓系统都还是5.10.x的内核呢。

这篇我们先简单的看看`kmalloc()`和`kfree()`。

# 调用链
我们先大致上看一下调用链（不完整的），以此理解大概有多少个步骤：
include/linux/slab.h, line 538
```
kmalloc()
|-- kmalloc_large() [size > 8192B(8KB)]   /* 一般是页级的 */
|   |-- kmalloc_order_trace()
|       |-- kmalloc_order()               /* 从Buddy分配一页并转换为地址返回 */
|           |-- alloc_pages()             /* 分配页 */
|           |-- page_address()            /* 把页转换为虚拟地址 */
|
|-- __kmalloc() [else]    /* 一般是对象级的 */
    |-- kmalloc_slab()    /* 找到应该分配多大内存的对象 */
    |-- slab_alloc()      /* 从Slab分配该对象地址 */
```
还有就是，CONFIG_SLOB的博主选择性忽略了，毕竟一般上我们用的机器都是SLUB的。

## 为什么会有两个分支？
其实原因很简单，一个负责分配大的，一个负责分配小的。
比如这样，我们写过许多结构体对吧？当我们分配时，是不是这样做的？
```
malloc(sizeof(struct foobar));
```

### SLAB
但是有一个问题，一般而言，我们的结构体能有多大呢？可能甚至10KB都没有，可能就几个字节而已呢。
但是，MMU管理的最小单位是4KB（现在安卓和iOS是16KB），这样不是很浪费吗？只用几个字节却要用那么大的页。
所以聪明的Linux内核开发就想到了，可以把所有申请来的结构体都存在一页，而且他们还能隔离哦，超级厉害！

本来可能是这样：[struct foobar 16B] -> [free 4080]
但是开发者们优化后，就会变成这样：[struct foobar 16B] -> [struct two 10B] -> [struct block 32B] -> [free...] 
这个，就叫做SLAB！

### BUDDY
而`kmalloc_large()`就很好理解啦，就是分配一页一页的内存，因为这样管理大一些的内存更高效呢。

# 源代码
好，现在来看代码吧，代码会让我们更好的理解！
同样的，我也会选择性忽略SLOB的实现。

## kmalloc
```C
static __always_inline void *kmalloc(size_t size, gfp_t flags)
{
	if (__builtin_constant_p(size)) { /* 如果size是常量 */

        /* 这里的值在SLUB配置是8KB */
		if (size > KMALLOC_MAX_CACHE_SIZE) 
			return kmalloc_large(size, flags);
			
	}
	return __kmalloc(size, flags);
}
```
这个代码没多难，首先检测值是否是编译期间的常量，我们平时用的`sizeof()`就是其中一个。
大于8KB的话就会走`kmalloc_large(size, flags)`，是页级的分配，因为8KB已经是两页的大小了，不是什么小体量。
小体量的话会走`__kmalloc(size, flags)`，分配的是一个SLAB的对象，可能比你预期的大小要来的大，但绝对不会更小。

### 知识补充点
```
__builtin_constant_p(size)
```
这个判断是，输入是否是编译期间的常量，可以提升几纳秒的速度（已经很好了！！）。
那什么是编译期间的常量呢？

编译时常量：
```C
#define SIZE 1024
static const int size = 1023+1;
1024+255
sizeof(struct foobar)
```
非编译时常量：
```C
int size = 1023+1;
int size = rdm();
int size = usr_input + 1024;
```

具体怎么优化呢？
差不多是这样：
本来我们内核模块写的是这样：
```C
char *addr = kmalloc(64, GFP_KERNEL);
```
由于`64`是常量，所以编译器就会这样优化我们的代码：
```C
char *addr = __kmalloc(64, GFP_KERNEL);
```
几纳秒的提升速度对一次分配来说可能没有什么区别，但是对频繁分配还是很有益的，可以为用户节省不少时间呢。

## __kmalloc
由于我们一般对`kmalloc()`的应用在小内存分配，所以就先看看对应的SLAB分配版本吧！

```C
void *__kmalloc(size_t size, gfp_t flags)
{
	struct kmem_cache *s;
	void *ret;
	
	if (unlikely(size > KMALLOC_MAX_CACHE_SIZE))
		return kmalloc_large(size, flags);
```
因为我们大概率是从kmalloc进来的，所以这个条件大部分情况下并不为真。

```C
	s = kmalloc_slab(size, flags);
```
这个函数是去找我们应该用什么大小的内存，比如我希望获得13字节的内存，但是内核觉得13这数字太邪门了，于是就给我分配了16字节的内存，比较吉利。
当然和信仰没关系，只是16更好对齐而已（笑）。

```C
	if (unlikely(ZERO_OR_NULL_PTR(s)))
		return s;
```
有时候，我们会输入`kmalloc(foobar, GFP_KERNEL)`，`foobar`可能为`0`，但是其实这是没问题的，内核允许发生这样的行为，所以只会取消分配内存，并不会报错，就像`kfree(NULL)`不会出问题一样。
注：申请`0`内存的话，返回为`((void *)16)`，非法或`kmalloc_slab()`函数失败返回`NULL`。

```C
	ret = slab_alloc(s, flags, _RET_IP_);
```
刚刚的`kmalloc_slab()`找到了要给调用放分配多少内存，这个函数做的就是分配内存的工作。

```C
	trace_kmalloc(_RET_IP_, ret, size, s->size, flags);

	ret = kasan_kmalloc(s, ret, size, flags);

	return ret;
}
```
这些是调试代码，kasan是Linux内核的内存调试工具我记得，不过博主现在还太笨了，要是对调试感兴趣的话那基本每个函数的学习时间都要上几倍，所以懒惰的博主就选择性略过了，读者们可以去看看更厉害的大佬发的笔记。


### 知识补充点
```C
EXPORT_SYMBOL(__kmalloc);
```
这个简单来说就是，如果有的话，内核模块就能直接调用了，如果没有的话内核模块就只能间接调用。
类似开放API吧，开放给内核模块使用。有另一个GPL版本的，那种是之开放给GPL协议的模块使用。

## kmalloc_slab
```C
struct kmem_cache *kmalloc_slab(size_t size, gfp_t flags)
{
	unsigned int index;

    /* 大概是内核开发者们深思熟虑后的一个值吧... */
	if (size <= 192) {
		if (!size)
			return ZERO_SIZE_PTR;

		index = size_index[size_index_elem(size)];
```
这里我们直接进入`size_index`这一个数组吧，毕竟不大。
```C
static u8 size_index[24] __ro_after_init = {
	3,	/* 8 */
	4,	/* 16 */
	5,	/* 24 */
	5,	/* 32 */
	6,	/* 40 */
	6,	/* 48 */
	6,	/* 56 */
	6,	/* 64 */
	1,	/* 72 */
	1,	/* 80 */
	1,	/* 88 */
	1,	/* 96 */
	7,	/* 104 */
	7,	/* 112 */
	7,	/* 120 */
	7,	/* 128 */
	2,	/* 136 */
	2,	/* 144 */
	2,	/* 152 */
	2,	/* 160 */
	2,	/* 168 */
	2,	/* 176 */
	2,	/* 184 */
	2	/* 192 */
};
```
这里其实并不难理解，逻辑大概是这样，如果传进来的是8字节，那么就会去3的下标，如果传进来的是16，就会去4的下标。
但是，为什么192字节的下标是2呢？是不是很奇怪呢？这个就要配合另一个函数看了呢（悲，嵌套真多呀）。

不过在那之前，我们得先知道，怎么得到这些索引。
```C
static inline unsigned int size_index_elem(unsigned int bytes)
{
	return (bytes - 1) / 8;
}
```
就是这样而已，非常简单，减1然后再除8。好那我们继续吧！

```C
const struct kmalloc_info_struct kmalloc_info[] __initconst = {
	INIT_KMALLOC_INFO(0, 0),               /* 0 */
	INIT_KMALLOC_INFO(96, 96),             /* 1 */
	INIT_KMALLOC_INFO(192, 192),           /* 2 */
	INIT_KMALLOC_INFO(8, 8),               /* 3 */
	INIT_KMALLOC_INFO(16, 16),             /* 4 */
	INIT_KMALLOC_INFO(32, 32),             /* 5 */
	INIT_KMALLOC_INFO(64, 64),             /* 6 */
	INIT_KMALLOC_INFO(128, 128),           /* 7 */
	INIT_KMALLOC_INFO(256, 256),           /* 8 */
	INIT_KMALLOC_INFO(512, 512),           /* 9 */
	INIT_KMALLOC_INFO(1024, 1k),           /* 10 */
	INIT_KMALLOC_INFO(2048, 2k),           /* 11 */
	INIT_KMALLOC_INFO(4096, 4k),           /* 12 */
	INIT_KMALLOC_INFO(8192, 8k),           /* 13 */
	INIT_KMALLOC_INFO(16384, 16k),         /* 14 */
	INIT_KMALLOC_INFO(32768, 32k),         /* 15 */
	INIT_KMALLOC_INFO(65536, 64k),         /* 16 */
	INIT_KMALLOC_INFO(131072, 128k),       /* 17 */
	INIT_KMALLOC_INFO(262144, 256k),       /* 18 */
	INIT_KMALLOC_INFO(524288, 512k),       /* 19 */
	INIT_KMALLOC_INFO(1048576, 1M),        /* 20 */
	INIT_KMALLOC_INFO(2097152, 2M),        /* 21 */
	INIT_KMALLOC_INFO(4194304, 4M),        /* 22 */
	INIT_KMALLOC_INFO(8388608, 8M),        /* 23 */
	INIT_KMALLOC_INFO(16777216, 16M),      /* 24 */
	INIT_KMALLOC_INFO(33554432, 32M),      /* 25 */
	INIT_KMALLOC_INFO(67108864, 64M)       /* 26 */
};
```
也就是说，如果传进来的是8字节，那么就会返回说“给调用方分8字节吧！”。
如果传进来的是77字节，我们来算一下，`(77 - 1) = 76, 76 / 8 = 9.5 == 9`，那么就是第9个！
我们看看是哪个，嗯，是这个：
```C
	1,	/* 80 */
    INIT_KMALLOC_INFO(96, 96),             /* 1 */
```
如果我们申请了77字节，系统就会给我们升级成96字节，原因我们先不用太在意，博主想可能是因为这个位比较有性价比之类的。
这里是通过`size_inde`定位到`kmalloc_info`的位置。

```C
	} else {
        /* 怎么想都不会触发这个吧（笑）*/
		if (WARN_ON_ONCE(size > KMALLOC_MAX_CACHE_SIZE))
			return NULL;
		index = fls(size - 1);
	}
```
`fls()`的话，是找到`size-1`最高的1位在第几位。
比如`size`是16，-1后就是15，也就是0000000000001111，最高的1位就是第四位，那我们看看4是多少：
```C
	INIT_KMALLOC_INFO(16, 16),             /* 4 */
```
我们可以发现，这里就不使用`size_index`了，而是直接定位到`kmalloc_info`的位置。


```C
	return kmalloc_caches[kmalloc_type(flags)][index];
}
```
这里就是返回“要哪里的内存+要多少内存”，类似一个标签，方便`slab_alloc()`分配。
感兴趣的可以先继续看下去，不感兴趣的可以直接不看这个函数了。

```C
static __always_inline enum kmalloc_cache_type kmalloc_type(gfp_t flags)
{
#ifdef CONFIG_ZONE_DMA
	/*
	 * The most common case is KMALLOC_NORMAL, so test for it
	 * with a single branch for both flags.
	 */
	if (likely((flags & (__GFP_DMA | __GFP_RECLAIMABLE)) == 0))
		return KMALLOC_NORMAL;
```
如果调用方所传入的`flags`不包含`__GFP_DMA`和`__GFP_RECLAIMABLE`，那么就直接返回`KMALLOC_NORMAL`。
可能是因为Linux认为一般上都用不到这两个，`GFP_KERNEL`也确实都没有这两个。

```C
	/*
	 * At least one of the flags has to be set. If both are, __GFP_DMA
	 * is more important.
	 */
	return flags & __GFP_DMA ? KMALLOC_DMA : KMALLOC_RECLAIM;
```
如果是开启了DMA区的配置，那么就会查看`flags`是否包含`__GFP_DMA`。
如果包含，就会返回`KMALLOC_DMA`，这样之后分配时系统就知道我们要把内存分配给DMA，以此更好的对这次分配做优化。
如果不包含，那就返回`KMALLOC_RECLAIM`，也就是可回收内存。

```C
#else
	return flags & __GFP_RECLAIMABLE ? KMALLOC_RECLAIM : KMALLOC_NORMAL;
#endif
}
```
不开DMA区的话，那就会查看我们的`flags`是否包含了`__GFP_RECLAIMABLE`。
如果有的话，就会返回`KMALLOC_RECLAIM`。
如果没有的话，就直接返回`KMALLOC_NORMAL`了，和DMA的区别就是少了个`KMALLOC_DMA`而已。

## slab_alloc
```C
static __always_inline void *slab_alloc(struct kmem_cache *s,
		gfp_t gfpflags, unsigned long addr)
{
	return slab_alloc_node(s, gfpflags, NUMA_NO_NODE, addr);
}
```
这个我们直接进去就好了，关于`NUMA_NO_NODE`的话，这个的意思是，哪个NODE好哪个来，让系统看着办。
不过NUMA一般是服务器的，我们的机器一般是UMA（至少博主的古老设备是）。

```C
static __always_inline void *slab_alloc_node(struct kmem_cache *s,
		gfp_t gfpflags, int node, unsigned long addr)
{
	void *object;
	struct kmem_cache_cpu *c;
	struct page *page;
	unsigned long tid;
	struct obj_cgroup *objcg = NULL;

	s = slab_pre_alloc_hook(s, &objcg, 1, gfpflags);
	if (!s)
		return NULL;
```
这个`slab_pre_alloc_hook()`主要是调试用的函数，博主太笨了，先跳过。

```C
redo:
	do {
		tid = this_cpu_read(s->cpu_slab->tid);
		c = raw_cpu_ptr(s->cpu_slab);
	} while (IS_ENABLED(CONFIG_PREEMPTION) &&
		 unlikely(tid != READ_ONCE(c->tid)));
```
这个是一个乐观锁，乐观锁就是，先做事情，如果错了就重来，也就是默认是对的。
`tid`是这次的SLAB分配器执行事务的事务ID。

`s->cpu_slab`是per-CPU变量，但是也是所有cpu共享的，读取时不需要同步，因为CPU不会修改其他CPU的这个变量。
`c->tid`是共享变量，可能被其他CPU同时修改。

`IS_ENABLED(CONFIG_PREEMPTION)`是说这个操作系统是否是抢占式操作系统，如果读者不知道的话，就默认是吧，因为我们的机器一般都是抢占式系统的，不过要是读者正在学单片机什么的，最好了解下自己机器的系统是什么的哦！（学单片机就认真点！！）

`unlikely(tid != READ_ONCE(c->tid)))`，这里做的是，这个CPU的`tid`是否和全局的`tid`一致，不一致的话就代表现在的CPU指针执行的地址内部可能有几个东西是不安全的，所以得重新来。

可能有点难以理解...差不多的意思就是：
"在我工作的时候，如果有人动过我的工具箱（tid变化了），我就得重新确认一下工作环境，避免把书放错位置！"

那可能被影响的工作环境是什么呢？博主知道的其中一个是这个：
```C
struct kmem_cache_cpu {
	void **freelist;	/* Pointer to next available object */
	unsigned long tid;	/* Globally unique transaction id */
	struct page *page;	/* The slab from which we are allocating */
#ifdef CONFIG_SLUB_CPU_PARTIAL
	struct page *partial;	/* Partially allocated frozen slabs */
#endif
#ifdef CONFIG_SLUB_STATS
	unsigned stat[NR_SLUB_STAT_ITEMS];
#endif
};
```
读者们可能不知道这个是什么，博主简单的说一下，这个就类似一个BUDDY FREELIST，只不过是SLUB版本的。
读者们可以这样理解，我们要分配给用户4KB的页，所以就准备了很多的4KB的页，都是每人用的，那么这个放着空闲页的盒子就叫做FREELIST。
SLAB的比较特别，因为SLAB是多多东西挤在一个页里的，所以`kmem_cache_cpu`就只会缓存一页，当然SLAB也是可以有两页的，不过那种自然就不适合在CPU上缓存嘛，所以就不在这个结构体啦。

我来给读者们说一下各个字段的含义：
- `void **freelist`： 这个就是指向下一个空闲的对象地址，之后我们还会看到新的东西，叫做FREE POINTER，它和这个很像。
- `unsigned long tid`： 这个刚刚说啦，就是让自己知道有没有别人动过我们工作环境的事务号。
- `struct page *page`： 这个就是那个挤一堆对象的页。
- `struct page *partial`： 这个是备用的，指向一个`page`链表，博主推测是满了后就可以快速换成另一个可用`page`。

```C
	barrier();
```
这个是给编译器提醒的，就是说，`barrier()`之前的代码，不能跑到`barrier()`之后。
同样的`barrier()`之后的代码，也不能跑到`barrier()`之前执行。
因为编译器和CPU都喜欢优化，所以可能会乱序一些代码，怎么开心怎么来，所以我们就用这个限制。

```C
	object = c->freelist;
	page = c->page;
```
刚刚说了，`freelist`就是指向第一个空闲对象的指针，再次提醒，他也可以叫FREE POINTER哦！

```C
	if (unlikely(!object || !page || !node_match(page, node))) {
		object = __slab_alloc(s, gfpflags, node, addr, c);
```
`node_match(page, node)`这个虽然几乎不可能触发，不过还是和读者们说一下，这个函数的作用是，查看我们获取到的`page`地址是否为`node`的本地地址内。
为什么几乎不可能触发呢？第一，我们是UMA机器。第二，我们已经和这个函数说了，哪个`node`开心就用哪个，也就是挑选最为合适的`node`。

然后`__slab_alloc`是失败的快速分配路径，也就是现在这个满了的意思，这个`page`/SLAB已经没有地方存放对象了。
这个函数大致上会这样做：
1. 先看当前CPU的`partial`链表有没有可用的`page`/SLAB。
2. 如果没有，去对应NUMA节点的`partial`链表找。
3. 如果还没有，那就只能从BUDDY分配全新的页了。

```C
	} else {
		void *next_object = get_freepointer_safe(s, object);                                                                                                                                                  
```
我们拿走了这个对象后，下一个空闲的对象在哪，函数将返回下一个空闲对象的地址。

```C
		if (unlikely(!this_cpu_cmpxchg_double(
				s->cpu_slab->freelist, s->cpu_slab->tid,
				object, tid,
				next_object, next_tid(tid)))) {

			note_cmpxchg_failure("slab_alloc", s, tid); /* 记录下来失败了 */
			goto redo;
		}
```
和刚刚的乐观锁差不多，`this_cpu_cmpxchg_double()`期待，到达这行时：
```C
s->cpu_slab->freelist == object
s->cpu_slab->tid == tid
```
如果确实是这样，那么就会执行：
```C
s->cpu_slab->frelist = next_object;
s->cpu_slab->tid = next_tid(tid);
```

```C
		prefetch_freepointer(s, next_object);
		stat(s, ALLOC_FASTPATH);
	}
```
`prefetch_freepointer()`： Linux觉得，我们不久后就会访问这个地址，也就是再申请多一个同类型的对象，所以就先预热一下，让等下可以直接缓存命中。

```C
	maybe_wipe_obj_freeptr(s, object); 

	if (unlikely(slab_want_init_on_alloc(gfpflags, s)) && object)
		memset(object, 0, s->object_size);

	slab_post_alloc_hook(s, objcg, gfpflags, 1, &object); /* 调试的，不管了 */

	return object; /* 大功告成！*/
}
```
`maybe_wipe_obj_freeptr()`： 这个就是在我们把对象分配出去之前，把`next_object`那里清理一下，以免调用方跑去访问那里结果不小心Kernel Panic。
`if (unlikely(slab_want_init_on_alloc(gfpflags, s)) && object)`： 这个放`unlikely`我还挺惊讶的，因为如果我们使用`kzalloc()`的话，这里就是负责清零的地方，可能是因为Linux认为开发者一般不会选择清零这种昂贵操作，所以就`unlikely`吧...

## kmalloc_large
好，现在来看一下`kmalloc_large()`，差点忘了这个函数。
```C
static __always_inline void *kmalloc_large(size_t size, gfp_t flags)
{
 unsigned int order = get_order(size);
 return kmalloc_order_trace(size, flags, order);
}
```
有trace的基本就是调试的意思，不过这里不能跳过了，跳了就没东西看了。

```C
#ifdef CONFIG_TRACING
void *kmalloc_order_trace(size_t size, gfp_t flags, unsigned int order)
{
 void *ret = kmalloc_order(size, flags, order);
 trace_kmalloc(_RET_IP_, ret, size, PAGE_SIZE << order, flags);
 return ret;
}
EXPORT_SYMBOL(kmalloc_order_trace);
#endif
```
好，这里我想读者们都看得懂，就是返回值要从一个名为`kmalloc_order()`的函数获取，理解这个就好了。

```C
void *kmalloc_order(size_t size, gfp_t flags, unsigned int order)
{
 void *ret = NULL;
 struct page *page;

 if (unlikely(flags & GFP_SLAB_BUG_MASK))
  flags = kmalloc_fix_flags(flags);
```
博主也看不懂`GFP_SLAB_BUG_MASK`是什么，不过会有一个函数帮我们修复标志，所以放心好了。

```C
 flags |= __GFP_COMP;
```
这个是复合页的意思，就是告诉Buddy分配器说“要把页合在一起”，而不是排在一起而已，如果有`__GFP_COMP`的话内核就能找到头页在哪。

```C
 page = alloc_pages(flags, order);
 if (likely(page)) {
  ret = page_address(page);
  mod_lruvec_page_state(page, NR_SLAB_UNRECLAIMABLE_B,
          PAGE_SIZE << order);
 }
```
这里就是从Buddy分配一个页，但是这个页不是我们平常用的那种，而是一个页管理结构体，我们需要把结构体转换为虚拟地址，也就是`page_address()`，这样我们就获得了一个我们平常使用的虚拟地址了。

```C
 ret = kasan_kmalloc_large(ret, size, flags);
 /* As ret might get tagged, call kmemleak hook after KASAN. */
 kmemleak_alloc(ret, size, 1, flags);
 return ret;
}
EXPORT_SYMBOL(kmalloc_order);
```
这些基本都是调试了，博主就不多说了，该看`kfree()`了。

# 总结
今天就先这样吧...博主好累了捏，明天继续更新这篇博客，加上`kfree()`的实现。
继续熬的话就要早上了...（倒下）不过现在这时间点是真的安静呀！

最后编辑时间：2025/10/26 AM06:33
